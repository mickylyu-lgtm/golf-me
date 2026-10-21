#!/usr/bin/env node
// Caddie V2 pilot measurement report (LOCAL_PILOT_WORKFLOW.md steps 10-11).
// Reads ONLY what the local tools wrote into the data folder and fills the
// local-prototype tables of docs/caddie-v2/EVAL_REPORT_TEMPLATE.md:
//   §0  offline check per run (browser log + OS network isolation)
//   §4a key-frame identification (states "not implemented": no detector)
//   §5  pose accuracy vs K00 key-frame labels (PROTOTYPE labels), per view
//   §5a landmark detection rate and confidence, per keypoint, per view
//   §8a processing time per swing, CPU and memory, per view
//   §8b face-on vs down-the-line comparison
// Rules: numbers only from real run files; a table with nothing behind it
// says "no data"; rows with fewer than 20 clips are marked "too few to
// conclude"; proportions carry a Wilson 95 % interval, clip-level values a
// seeded bootstrap 95 % interval. Phases, faults, drills, coaching: not
// implemented, and the report says so.
//
// "View" = the angle the clip was FILMED as (manifest capture.angle), which
// is the protocol slot, not a coach label.
//
// Writes <data dir>/reports/pilot-report-<variant>-<date>.md and .json
// (clip IDs and numbers only). Review before copying anything into the repo.
//
// Usage: node tools/caddie-eval/pilot-report.mjs [--variant full|heavy] [--stdout]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { QG_MIN_KEYPOINT_CONFIDENCE } from "../../src/lib/caddie/v2/qualityGate.ts";
import { EvalError, PROTOTYPE_CAPABILITIES, assertLocalProcessingAllowed, defaultDataDir, isImplemented, mkdirPrivate, openDataDir, todayIso, writeDataJson } from "./import-clip.mjs";
import { ANNOTATION_KEYPOINTS, ANNOTATION_LABEL_STATUS, KEYFRAME_EVENTS, annotationToScorerLabels, readAnnotationChain } from "./lib/annotations.mjs";
import { KEYFRAME_TOLERANCE_MS } from "./lib/keyframeAccuracy.mjs";
import { MIN_CLIPS_TO_CONCLUDE, bootstrapCi, mean, median, quantile, wilson } from "./lib/stats.mjs";
import { EXPECTED_BLOCKED_HOSTS } from "./pose-local.mjs";
import { PHASES, scorePoseAgainstLabels } from "./pose-accuracy.mjs";
import { validatePoseSequence } from "./run-v2-checks.mjs";

export const REPORT_SCHEMA = 1;
export const NO_DATA = "no data";
export const VIEWS = ["face_on", "down_the_line"];
export const POINT_GROUPS = {
  Shoulders: ["left_shoulder", "right_shoulder"],
  Hips: ["left_hip", "right_hip"],
  Elbows: ["left_elbow", "right_elbow"],
  Wrists: ["left_wrist", "right_wrist"],
  Knees: ["left_knee", "right_knee"],
  Ankles: ["left_ankle", "right_ankle"],
  Nose: ["nose"],
  "All 13": ANNOTATION_KEYPOINTS,
};
const ANNOTATOR = "K00";

const readJsonIf = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined; // present but unreadable
  }
};

/** Per-keypoint detection counts for one PoseSequence. */
export function detectionStats(seq, minConfidence = QG_MIN_KEYPOINT_CONFIDENCE) {
  const per = Object.fromEntries(ANNOTATION_KEYPOINTS.map((n) => [n, { present: 0, confident: 0, confidences: [] }]));
  let framesWithPose = 0;
  for (const f of seq.frames) {
    const kps = f.keypoints ?? {};
    if (Object.keys(kps).length) framesWithPose++;
    for (const n of ANNOTATION_KEYPOINTS) {
      const kp = kps[n];
      if (!kp) continue;
      per[n].present++;
      per[n].confidences.push(kp.confidence);
      if (kp.confidence >= minConfidence) per[n].confident++;
    }
  }
  return { frames: seq.frames.length, framesWithPose, minConfidence, perKeypoint: per };
}

/** Offline verdict for one run file. */
export function offlineVerdict(run) {
  const n = run?.network;
  if (!n) return { verdict: "not recorded", unexpectedHosts: [], isolated: null };
  const unexpectedHosts = Object.keys(n.blocked ?? {}).filter((h) => !EXPECTED_BLOCKED_HOSTS.includes(h));
  const externalAllowed = n.externalRequestsAllowed;
  const isolated = n.osIsolation ? n.osIsolation.isolated === true : null;
  let verdict;
  if (externalAllowed === undefined) verdict = "not recorded (run file predates the counter)";
  else if (externalAllowed !== 0) verdict = "FAILED: external request allowed";
  else if (unexpectedHosts.length || (n.blockedWebSockets ?? 0) > 0) verdict = "zero external requests; UNEXPECTED blocked attempts (investigate)";
  else if (isolated === true) verdict = "offline verified (0 external requests allowed; no network interface)";
  else if (isolated === false) verdict = "0 external requests allowed (browser block only; NOT OS-isolated)";
  else verdict = "0 external requests allowed (OS isolation not recorded)";
  return { verdict, unexpectedHosts, isolated, externalAllowed: externalAllowed ?? null };
}

/** Collects everything the report needs for one clip. Never throws for missing data. */
async function collectClip(dataDir, layout, entry, variant, today) {
  const clipId = entry.clipId;
  const out = { clipId, view: entry.capture?.angle ?? null, handedness: entry.capture?.handedness ?? null, club: entry.capture?.club ?? null, problems: [] };
  try {
    await assertLocalProcessingAllowed(dataDir, clipId, { today, checkFile: false });
  } catch (err) {
    if (!(err instanceof EvalError)) throw err;
    out.refused = err.message;
    return out;
  }
  const dir = path.join(layout.derived, clipId);
  const seq = readJsonIf(path.join(dir, `pose-mediapipe-${variant}.json`));
  if (seq === undefined) out.problems.push("pose file unreadable");
  else if (seq) {
    const p = validatePoseSequence(seq);
    if (p.length) out.problems.push(`pose file malformed: ${p.join("; ")}`);
    else out.detection = detectionStats(seq);
  }
  const run = readJsonIf(path.join(dir, `pose-mediapipe-${variant}.run.json`));
  if (run) out.run = run;
  const checks = readJsonIf(path.join(dir, `v2-checks-mediapipe-${variant}.json`));
  if (checks) out.checks = checks;
  const chain = readAnnotationChain(layout.annotations, clipId, ANNOTATOR);
  if (chain.problems.length) out.problems.push(...chain.problems);
  if (chain.latest) {
    out.annotation = { version: chain.latest.version, keyframes: Object.fromEntries(KEYFRAME_EVENTS.map((e) => [e, chain.latest.keyframes[e].status])) };
    if (out.detection) {
      try {
        out.accuracy = scorePoseAgainstLabels(seq, annotationToScorerLabels(chain.latest));
      } catch (err) {
        if (!(err instanceof EvalError)) throw err;
        out.problems.push(`accuracy not scored: ${err.message}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- formatting

const fmt = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? NO_DATA : String(Math.round(v * 10 ** d) / 10 ** d));
const ciText = (ci, d = 3) => (ci ? ` [${fmt(ci[0], d)}, ${fmt(ci[1], d)}]` : "");
const few = (nClips) => (nClips > 0 && nClips < MIN_CLIPS_TO_CONCLUDE ? " *" : "");

/** "0.912 (52/57) [0.81, 0.96]" or "no data". */
export function propCell(k, n, nClips) {
  if (!n) return NO_DATA;
  return `${fmt(k / n)} (${k}/${n})${ciText(wilson(k, n))}${few(nClips)}`;
}

/** Clip-level mean with bootstrap CI, or "no data". */
export function clipMeanCell(values, d = 3) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return NO_DATA;
  return `${fmt(mean(v), d)}${ciText(bootstrapCi(v, mean), d)} (n=${v.length})${few(v.length)}`;
}

function distCells(values, d = 1) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [NO_DATA, NO_DATA, NO_DATA, NO_DATA];
  return [`${v.length}${few(v.length)}`, `${fmt(median(v), d)}${ciText(bootstrapCi(v, median), d)}`, fmt(quantile(v, 0.9), d), fmt(Math.max(...v), d)];
}

const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

// ---------------------------------------------------------------- aggregation

/** Sums raw scorer counts over clips; pick(clip) returns the count objects to add. */
function sumCounts(results, pick) {
  const raw = { labeledVisible: 0, predicted: 0, within01: 0, within02: 0, confidentFar: 0, errorSum: 0, labeledNotVisible: 0, falseObservations: 0, labeledOccluded: 0, occludedPredicted: 0, occludedWithin02: 0 };
  for (const r of results) for (const c of pick(r)) for (const k of Object.keys(raw)) raw[k] += c[k] ?? 0;
  return { raw };
}

function accuracyRows(clips) {
  const scored = clips.filter((c) => c.accuracy);
  const nClips = scored.length;
  return Object.entries(POINT_GROUPS).map(([group, names]) => {
    const s = sumCounts(scored, (c) => names.map((n) => c.accuracy.raw.byKeypoint[n]));
    const r = s.raw;
    return [
      group,
      nClips ? String(r.labeledVisible) : NO_DATA,
      propCell(r.within01, r.labeledVisible, nClips),
      propCell(r.within02, r.labeledVisible, nClips),
      nClips ? String(r.labeledNotVisible) : NO_DATA,
      propCell(r.labeledNotVisible - r.falseObservations, r.labeledNotVisible, nClips),
      propCell(r.confidentFar + r.falseObservations, r.predicted + r.falseObservations, nClips),
      nClips ? String(r.labeledOccluded) : NO_DATA,
      propCell(r.occludedPredicted, r.labeledOccluded, nClips),
    ];
  });
}

function phaseRows(clips) {
  const scored = clips.filter((c) => c.accuracy);
  return PHASES.map((ph) => {
    const s = sumCounts(scored, (c) => [c.accuracy.raw.byPhase[ph]]);
    const r = s.raw;
    const frames = scored.reduce((a, c) => a + (c.accuracy.raw.byPhase[ph].labeledVisible + c.accuracy.raw.byPhase[ph].labeledNotVisible + c.accuracy.raw.byPhase[ph].labeledOccluded > 0 ? 1 : 0), 0);
    return [ph, frames ? String(frames) : NO_DATA, propCell(r.within01, r.labeledVisible, scored.length), propCell(r.within02, r.labeledVisible, scored.length), propCell(r.confidentFar + r.falseObservations, r.predicted + r.falseObservations, scored.length)];
  });
}

function detectionRate(c, names, kind = "confident") {
  if (!c.detection?.frames) return null;
  const k = names.reduce((a, n) => a + c.detection.perKeypoint[n][kind], 0);
  return k / (c.detection.frames * names.length);
}

function detectionRows(byView) {
  return ANNOTATION_KEYPOINTS.map((name) => {
    const row = [name];
    for (const v of VIEWS) {
      const clips = byView[v].filter((c) => c.detection);
      row.push(clipMeanCell(clips.map((c) => detectionRate(c, [name]))));
      row.push(clipMeanCell(clips.map((c) => detectionRate(c, [name], "present"))));
      const confs = clips.flatMap((c) => c.detection.perKeypoint[name].confidences);
      row.push(confs.length ? `${fmt(median(confs))} / ${fmt(quantile(confs, 0.1))}` : NO_DATA);
    }
    return row;
  });
}

const PERF_MEASURES = [
  ["Model load (ms)", (c) => c.run?.performance?.modelLoadMs, 0],
  ["Inference per frame, clip median (ms)", (c) => c.run?.performance?.inferenceMsPerFrame?.median, 1],
  ["Round trip per frame, clip median (ms)", (c) => c.run?.performance?.roundTripMsPerFrame?.median, 1],
  ["Processing time per swing, wall (s)", (c) => c.run?.performance?.wallSecondsTotal, 2],
  ["Wall time / clip length", (c) => c.run?.performance?.realtimeFactor, 2],
  ["CPU seconds per swing (all processes)", (c) => c.run?.resources?.cpuSeconds?.total, 2],
  ["Average cores busy", (c) => c.run?.resources?.avgCoresBusy, 2],
  ["Peak RSS, sum of processes (MB)", (c) => (Number.isFinite(c.run?.resources?.peakRssBytes?.total) ? c.run.resources.peakRssBytes.total / 1048576 : null), 0],
  ["Peak RSS, Chromium (MB)", (c) => (Number.isFinite(c.run?.resources?.peakRssBytes?.chromium) ? c.run.resources.peakRssBytes.chromium / 1048576 : null), 0],
  ["V2 checks run time (ms)", (c) => c.checks?.runMs, 2],
];

function comparisonRows(byView) {
  const cell = (v, fn) => fn(byView[v]);
  const rows = [];
  const add = (label, fn) => rows.push([label, ...VIEWS.map((v) => cell(v, fn))]);
  add("Clips with a pose run (n)", (cs) => String(cs.filter((c) => c.detection).length));
  add("Frames with a pose (clip mean)", (cs) => clipMeanCell(cs.filter((c) => c.detection).map((c) => c.detection.framesWithPose / (c.detection.frames || NaN))));
  add("Confident detection, all 13 (clip mean)", (cs) => clipMeanCell(cs.map((c) => detectionRate(c, ANNOTATION_KEYPOINTS))));
  for (const [g, names] of Object.entries(POINT_GROUPS)) if (g !== "All 13") add(`Confident detection, ${g.toLowerCase()}`, (cs) => clipMeanCell(cs.map((c) => detectionRate(c, names))));
  add("Median keypoint confidence (all frames, all 13)", (cs) => {
    const confs = cs.filter((c) => c.detection).flatMap((c) => ANNOTATION_KEYPOINTS.flatMap((n) => c.detection.perKeypoint[n].confidences));
    return confs.length ? fmt(median(confs)) : NO_DATA;
  });
  const acc = (cs, f) => {
    const s = cs.filter((c) => c.accuracy);
    const r = sumCounts(s, (c) => [c.accuracy.raw.overall]).raw;
    return f(r, s.length);
  };
  add("PCK@0.2 vs K00 (visible labels; prototype labels)", (cs) => acc(cs, (r, n) => propCell(r.within02, r.labeledVisible, n)));
  add("Honest abstention vs K00", (cs) => acc(cs, (r, n) => propCell(r.labeledNotVisible - r.falseObservations, r.labeledNotVisible, n)));
  add("Confident-wrong vs K00", (cs) => acc(cs, (r, n) => propCell(r.confidentFar + r.falseObservations, r.predicted + r.falseObservations, n)));
  add("Quality gate pass", (cs) => {
    const s = cs.filter((c) => c.checks);
    return propCell(s.filter((c) => c.checks.qualityGate?.status === "pass").length, s.length, s.length);
  });
  add("Camera angle = filmed angle", (cs) => {
    const s = cs.filter((c) => c.checks);
    return propCell(s.filter((c) => c.checks.angleVsIntent === "match").length, s.length, s.length);
  });
  add("Inference ms/frame (median of clip medians)", (cs) => distCells(cs.map((c) => c.run?.performance?.inferenceMsPerFrame?.median))[1]);
  add("Processing time per swing, s (median)", (cs) => distCells(cs.map((c) => c.run?.performance?.wallSecondsTotal), 2)[1]);
  add("Peak RSS MB (median)", (cs) => distCells(cs.map((c) => (Number.isFinite(c.run?.resources?.peakRssBytes?.total) ? c.run.resources.peakRssBytes.total / 1048576 : null)), 0)[1]);
  add("Key-frame identification", () => (isImplemented("swing_phases") ? "see §4a" : "not implemented"));
  return rows;
}

function gitCommit() {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.dirname(fileURLToPath(import.meta.url)), encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Builds the report object and its markdown. Pure over the data folder (reads only). */
export async function buildPilotReport(dataDir, { variant = "full", today = todayIso() } = {}) {
  const layout = openDataDir(dataDir);
  const manifest = JSON.parse(fs.readFileSync(layout.manifest, "utf8"));
  const clips = [];
  for (const entry of manifest.clips) clips.push(await collectClip(dataDir, layout, entry, variant, today));
  const active = clips.filter((c) => !c.refused);
  const byView = Object.fromEntries([...VIEWS, "unsuitable"].map((v) => [v, active.filter((c) => c.view === v)]));
  const runs = active.filter((c) => c.run);
  const offline = runs.map((c) => ({ clipId: c.clipId, view: c.view, ...offlineVerdict(c.run), network: c.run.network }));
  const contributors = new Set(active.map((c) => c.clipId.slice(0, 4)));
  const handed = { right: active.filter((c) => c.handedness === "right").length, left: active.filter((c) => c.handedness === "left").length };
  const annotated = active.filter((c) => c.annotation);

  const md = [];
  md.push(`# Caddie V2 pilot measurements (local prototype, MediaPipe ${variant})`);
  md.push("");
  md.push(`Generated ${today} by \`tools/caddie-eval/pilot-report.mjs\` from the data folder's own run files${gitCommit() ? ` (tool commit ${gitCommit()})` : ""}. Clip IDs and numbers only. **Results describe this dataset only; they are not product accuracy claims.**`);
  md.push("");
  md.push(`- Accuracy and key-frame numbers use **K00 PROTOTYPE labels** (\`${ANNOTATION_LABEL_STATUS}\`): one annotator, not validated ground truth, no inter-rater check.`);
  md.push(`- "View" is the angle the clip was filmed as (manifest), not a coach label. * = fewer than ${MIN_CLIPS_TO_CONCLUDE} clips: **too few to conclude**. Intervals: Wilson 95 % for proportions (points treated as independent, which overstates precision), seeded clip-level bootstrap 95 % (2,000 resamples) for clip means and medians.`);
  md.push(`- Confident = confidence >= ${QG_MIN_KEYPOINT_CONFIDENCE} (\`QG_MIN_KEYPOINT_CONFIDENCE\`, a provisional placeholder).`);
  md.push(`- Not implemented in the prototype, so not measured: ${Object.entries(PROTOTYPE_CAPABILITIES).filter(([k]) => !isImplemented(k)).map(([k]) => k.replaceAll("_", " ")).join(", ")}.`);
  md.push("");
  md.push("## Dataset");
  md.push("");
  md.push(
    table(
      ["Measure", "Value"],
      [
        ["Manifest revision", String(manifest.revision ?? NO_DATA)],
        ["Clips in manifest / usable today", `${clips.length} / ${active.length}`],
        ["Contributors (count only)", active.length ? String(contributors.size) : NO_DATA],
        ["Face-on / down-the-line / unsuitable clips", `${byView.face_on.length} / ${byView.down_the_line.length} / ${byView.unsuitable.length}`],
        ["Right / left-handed clips", active.length ? `${handed.right} / ${handed.left}${handed.left ? "" : " (left-handed: not measured)"}` : NO_DATA],
        [`Clips with a pose run (${variant})`, String(runs.length)],
        ["Clips with K00 annotations (latest version used)", String(annotated.length)],
      ],
    ),
  );
  const refused = clips.filter((c) => c.refused);
  if (refused.length) md.push("", table(["Clip", "Refused by the local gate"], refused.map((c) => [c.clipId, c.refused])));
  const withProblems = active.filter((c) => c.problems.length);
  if (withProblems.length) md.push("", table(["Clip", "Data problem (not scored)"], withProblems.map((c) => [c.clipId, c.problems.join("; ")])));

  md.push("", "## §0 Offline check (per pose run)", "");
  md.push(
    offline.length
      ? table(
          ["Clip", "View", "Served locally (files + frames)", "External requests allowed", "Blocked attempts", "Unexpected", "OS network interfaces", "Verdict"],
          offline.map((o) => [
            o.clipId,
            o.view ?? NO_DATA,
            `${o.network.allowedRequests ?? NO_DATA} + ${o.network.framesServed ?? NO_DATA}`,
            String(o.externalAllowed ?? NO_DATA),
            JSON.stringify(o.network.blocked ?? {}),
            o.unexpectedHosts.join(", ") || "none",
            o.network.osIsolation ? String(o.network.osIsolation.nonLoopbackInterfaces) : NO_DATA,
            o.verdict,
          ]),
        )
      : NO_DATA,
  );
  md.push("", `Runs verified offline (0 external requests allowed, only expected blocks, no network interface): ${offline.length ? `${offline.filter((o) => o.verdict.startsWith("offline verified")).length} of ${offline.length}` : NO_DATA}. Expected block: ${EXPECTED_BLOCKED_HOSTS.join(", ")} (MediaPipe usage logger, see MEDIAPIPE_TELEMETRY_AUDIT.md).`);

  md.push("", "## §4a Key-frame identification", "");
  if (!isImplemented("swing_phases")) {
    md.push(`**Not implemented.** The local prototype has no key-frame detector, so there is no prediction to score and no accuracy is claimed. When one exists, it is scored against K00 key frames with a tolerance of ±${KEYFRAME_TOLERANCE_MS} ms (and ±1 frame) by \`lib/keyframeAccuracy.mjs\`.`);
    md.push("");
    md.push(table(["Key frame", "K00 labeled (clips)", "K00 not in clip / can't tell", "Detector accuracy"], KEYFRAME_EVENTS.map((e) => [e, annotated.length ? String(annotated.filter((c) => c.annotation.keyframes[e] === "labeled").length) : NO_DATA, annotated.length ? String(annotated.filter((c) => c.annotation.keyframes[e] !== "labeled").length) : NO_DATA, "not implemented"])));
  }

  for (const v of ["all", ...VIEWS]) {
    const cs = v === "all" ? active : byView[v];
    md.push("", `## §5 Pose accuracy vs K00 key-frame labels: ${v === "all" ? "all views" : v} (PROTOTYPE labels)`, "");
    md.push(`Clips scored: ${cs.filter((c) => c.accuracy).length}.`);
    md.push("");
    md.push(table(["Point group", "Visible labels (n)", "PCK@0.1 [95 % CI]", "PCK@0.2 [95 % CI]", '"Not visible" labels (n)', "Honest abstention", "Confident-wrong", "Occluded labels (n)", "Occluded: confident"], accuracyRows(cs)));
    md.push("");
    md.push(table(["Key frame", "Clips with this frame scored (n)", "PCK@0.1", "PCK@0.2", "Confident-wrong"], phaseRows(cs)));
  }

  md.push("", "## §5a Landmark detection rate and confidence, per keypoint, per view", "");
  md.push("Rate = share of analyzed frames where the keypoint is reported (confident: at or above the threshold; any: at any confidence), averaged over clips. Confidence = median / 10th percentile over every reported keypoint in every frame.");
  md.push("");
  md.push(table(["Keypoint", ...VIEWS.flatMap((v) => [`${v}: confident rate`, `${v}: any`, `${v}: conf. median / p10`])], detectionRows(byView)));

  md.push("", "## §8a Processing time, CPU and memory per swing", "");
  md.push(`Hardware (from the run files): ${runs.length ? [...new Set(runs.map((c) => `${c.run.hardware?.cpuModel ?? "?"}, ${c.run.hardware?.logicalCores ?? "?"} cores, ${Math.round((c.run.hardware?.totalMemoryBytes ?? 0) / 1073741824)} GB, ${c.run.hardware?.wsl ? "WSL" : c.run.hardware?.platform ?? "?"}, Node ${c.run.hardware?.node ?? "?"}, Chromium ${c.run.provenance?.chromium ?? "?"}, ${c.run.provenance?.delegate ?? "?"} delegate`))].join("; ") : NO_DATA}. Laptop numbers; they say nothing about a phone.`);
  md.push("");
  md.push(
    table(
      ["Measure", "View", "Clips (n)", "p50 [95 % CI]", "p90", "Max"],
      PERF_MEASURES.flatMap(([label, fn, d]) => ["all", ...VIEWS].map((v) => [label, v, ...distCells((v === "all" ? active : byView[v]).map(fn), d)])),
    ),
  );

  md.push("", "## §8b Face-on vs down-the-line", "");
  md.push(table(["Measure", ...VIEWS], comparisonRows(byView)));
  md.push("");
  md.push("Swing phases, measurements, faults, coaching explanations, drills: **not implemented** in the prototype; nothing to compare.");

  const report = {
    schema: REPORT_SCHEMA,
    tool: "tools/caddie-eval/pilot-report.mjs",
    createdOn: today,
    variant,
    labelStatus: ANNOTATION_LABEL_STATUS,
    capabilities: PROTOTYPE_CAPABILITIES,
    clips: clips.map((c) => ({
      clipId: c.clipId,
      view: c.view,
      handedness: c.handedness,
      refused: c.refused ?? null,
      problems: c.problems ?? [],
      detection: c.detection ? { frames: c.detection.frames, framesWithPose: c.detection.framesWithPose, confidentRate: Object.fromEntries(ANNOTATION_KEYPOINTS.map((n) => [n, detectionRate(c, [n])])) } : null,
      accuracy: c.accuracy ? { overall: c.accuracy.overall, framesScored: c.accuracy.framesScored, annotationVersion: c.annotation.version } : null,
      offline: c.run ? offlineVerdict(c.run) : null,
      performance: c.run ? { wallSecondsTotal: c.run.performance?.wallSecondsTotal ?? null, inferenceMedianMs: c.run.performance?.inferenceMsPerFrame?.median ?? null, cpuSeconds: c.run.resources?.cpuSeconds?.total ?? null, peakRssBytes: c.run.resources?.peakRssBytes?.total ?? null } : null,
    })),
    keyframeIdentification: isImplemented("swing_phases") ? "see markdown" : "not implemented",
  };
  return { report, markdown: `${md.join("\n")}\n` };
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { variant: { type: "string" }, stdout: { type: "boolean" } } });
  const variant = values.variant ?? "full";
  if (!/^[a-z]+$/.test(variant)) throw new EvalError("--variant must be a model variant name, e.g. full");
  const dataDir = defaultDataDir();
  const today = todayIso();
  const { report, markdown } = await buildPilotReport(dataDir, { variant, today });
  if (values.stdout) {
    process.stdout.write(markdown);
    return 0;
  }
  const layout = openDataDir(dataDir);
  const dir = path.join(layout.root, "reports");
  mkdirPrivate(dir);
  const base = path.join(dir, `pilot-report-${variant}-${today}`);
  writeDataJson(layout, `${base}.json`, report);
  fs.writeFileSync(`${base}.md`, markdown, { mode: 0o600 });
  process.stdout.write(`Wrote reports/${path.basename(base)}.md and .json in the data folder. Review before copying anything into docs/caddie-v2/eval-reports/.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`pilot-report: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      process.exit(1);
    },
  );
}
