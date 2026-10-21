#!/usr/bin/env node
// Pose accuracy of the local pose source against hand-marked key-frame
// keypoints (TESTING_PROTOCOL.md §8 "Key-frame keypoints"). Local only.
//
// Label format: the `keyframe_keypoints` field of labels/<clip>-<labeler>.json
// (labeler = a coach ID, K01, or Micky's ID for geometry labels, also Kxx):
//   { "frame_width": 1080, "frame_height": 1920,   // pixel size the points were marked in (as displayed, upright)
//     "frames": [ { "phase": "address" | "top" | "impact", "t": 1.234,
//                   "points": { "left_shoulder": [x, y] | "not_visible", ... } } ] }
// Points use the GOLFER's anatomical left/right. A point left out = not labeled.
//
// Metric (EVAL_REPORT_TEMPLATE.md §5):
// - error = 2-D distance / torso length, where torso length = labeled
//   shoulder midpoint to hip midpoint in that frame (frame not scorable
//   unless both shoulders and both hips are labeled visible). The BlazePose
//   model card normalizes by torso DIAMETER instead, so its PDJ numbers are
//   not directly comparable;
// - a prediction counts only if its confidence passes the quality gate's
//   keypoint threshold; a missing prediction for a visible label is a miss;
// - PCK@0.1 and PCK@0.2 per keypoint, per phase, overall;
// - abstention: for "not_visible" labels, how often the model still reported
//   a confident point (false observation); confident-wrong as in the template.
// The pose frame used is the one nearest to t, within half a frame interval.
//
// Usage: node tools/caddie-eval/pose-accuracy.mjs --clip C001-0001 --labeler K01 [--variant full]
//        node tools/caddie-eval/pose-accuracy.mjs --all [--variant full]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { QG_MIN_KEYPOINT_CONFIDENCE } from "../../src/lib/caddie/v2/qualityGate.ts";
import { POSE_KEYPOINT_NAMES } from "../../src/lib/caddie/v2/types.ts";
import { EvalError, LABEL_FILE_RE, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso, writeDataJson } from "./import-clip.mjs";
import { validatePoseSequence } from "./run-v2-checks.mjs";

export const POSE_ACCURACY_VERSION = "0.1.0";
const PHASES = ["address", "top", "impact"];

function emptyCounts() {
  return { labeledVisible: 0, predicted: 0, within01: 0, within02: 0, confidentFar: 0, errorSum: 0, labeledNotVisible: 0, falseObservations: 0 };
}

function add(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k];
  return a;
}

export function finalize(c) {
  const r = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
  return {
    ...c,
    errorSum: r(c.errorSum),
    detectionRate: c.labeledVisible ? r(c.predicted / c.labeledVisible) : null,
    pck01: c.labeledVisible ? r(c.within01 / c.labeledVisible) : null,
    pck02: c.labeledVisible ? r(c.within02 / c.labeledVisible) : null,
    meanNormalizedErrorWhenPredicted: c.predicted ? r(c.errorSum / c.predicted) : null,
    falseObservationRate: c.labeledNotVisible ? r(c.falseObservations / c.labeledNotVisible) : null,
    honestAbstention: c.labeledNotVisible ? r(1 - c.falseObservations / c.labeledNotVisible) : null,
    // Template §5: confident points > 0.2 torso lengths off, or confident on a hidden point, over all confident points.
    confidentWrongRate: c.predicted + c.falseObservations ? r((c.confidentFar + c.falseObservations) / (c.predicted + c.falseObservations)) : null,
  };
}

/** Validates the keyframe_keypoints block. Returns problems (empty = valid). */
export function validateKeyframeLabels(k) {
  const problems = [];
  if (typeof k !== "object" || k === null) return ["keyframe_keypoints must be an object"];
  if (!(Number.isFinite(k.frame_width) && k.frame_width > 0 && Number.isFinite(k.frame_height) && k.frame_height > 0)) problems.push("frame_width/frame_height");
  if (!Array.isArray(k.frames)) return [...problems, "frames"];
  for (const [i, f] of k.frames.entries()) {
    if (!PHASES.includes(f?.phase)) problems.push(`frames[${i}].phase`);
    if (!(Number.isFinite(f?.t) && f.t >= 0)) problems.push(`frames[${i}].t`);
    if (typeof f?.points !== "object" || f.points === null) {
      problems.push(`frames[${i}].points`);
      continue;
    }
    for (const [name, v] of Object.entries(f.points)) {
      if (!POSE_KEYPOINT_NAMES.includes(name)) problems.push(`frames[${i}]: unknown keypoint ${name}`);
      else if (v !== "not_visible" && !(Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))) problems.push(`frames[${i}].${name}`);
    }
  }
  return problems;
}

function nearestFrame(sequence, t) {
  const fps = sequence.analysisFps;
  const tol = fps ? 0.5 / fps + 0.001 : 0.02;
  let best = null;
  for (const f of sequence.frames) {
    const d = Math.abs(f.timestampSeconds - t);
    if (d <= tol && (!best || d < best.d)) best = { f, d };
  }
  return best?.f ?? null;
}

/** Shoulder-midpoint to hip-midpoint distance in the labels (EVAL_REPORT_TEMPLATE.md §5), or null. */
function torsoLength(points) {
  const p = (n) => (Array.isArray(points[n]) ? points[n] : null);
  const ls = p("left_shoulder");
  const rs = p("right_shoulder");
  const lh = p("left_hip");
  const rh = p("right_hip");
  if (!ls || !rs || !lh || !rh) return null;
  const d = Math.hypot((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2);
  return d > 0 ? d : null;
}

/** Pure scoring of one sequence against one keyframe_keypoints block. */
export function scorePoseAgainstLabels(sequence, labels, { minConfidence = QG_MIN_KEYPOINT_CONFIDENCE } = {}) {
  const problems = validateKeyframeLabels(labels);
  if (problems.length) throw new EvalError(`keyframe_keypoints invalid: ${problems.join("; ")}`);
  if (sequence.coordinateSpace !== "source_pixels" || !sequence.sourceWidth || !sequence.sourceHeight) {
    throw new EvalError("pose sequence must be in source_pixels with a known frame size");
  }
  const sx = labels.frame_width / sequence.sourceWidth;
  const sy = labels.frame_height / sequence.sourceHeight;
  if (Math.abs(sx - sy) / Math.max(sx, sy) > 0.02) throw new EvalError("label frame aspect ratio differs from the analyzed frame (rotated or cropped?)");

  const overall = emptyCounts();
  const byKeypoint = Object.fromEntries(POSE_KEYPOINT_NAMES.map((n) => [n, emptyCounts()]));
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, emptyCounts()]));
  const skipped = [];
  for (const lf of labels.frames) {
    const pf = nearestFrame(sequence, lf.t);
    if (!pf) {
      skipped.push({ phase: lf.phase, t: lf.t, reason: "no pose frame within half a frame of t" });
      continue;
    }
    const torso = torsoLength(lf.points);
    if (torso === null) {
      skipped.push({ phase: lf.phase, t: lf.t, reason: "both shoulders and both hips must be labeled visible" });
      continue;
    }
    for (const [name, v] of Object.entries(lf.points)) {
      const c = emptyCounts();
      const kp = pf.keypoints[name];
      const confident = kp && kp.confidence >= minConfidence ? kp : null;
      if (v === "not_visible") {
        c.labeledNotVisible = 1;
        if (confident) c.falseObservations = 1;
      } else {
        c.labeledVisible = 1;
        if (confident) {
          c.predicted = 1;
          const err = Math.hypot(confident.x * sx - v[0], confident.y * sy - v[1]) / torso;
          c.errorSum = err;
          if (err <= 0.1) c.within01 = 1;
          if (err <= 0.2) c.within02 = 1;
          else c.confidentFar = 1;
        }
      }
      add(overall, c);
      add(byKeypoint[name], c);
      add(byPhase[lf.phase], c);
    }
  }
  return {
    moduleVersion: POSE_ACCURACY_VERSION,
    minConfidence,
    framesLabeled: labels.frames.length,
    framesScored: labels.frames.length - skipped.length,
    skipped,
    overall: finalize(overall),
    byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, finalize(v)])),
    byKeypoint: Object.fromEntries(Object.entries(byKeypoint).map(([k, v]) => [k, finalize(v)])),
    raw: { overall, byPhase, byKeypoint },
  };
}

export async function scoreClip(dataDir, clipId, labeler, { variant = "full", today = todayIso() } = {}) {
  const { derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today, checkFile: false });
  const labelFile = path.join(layout.labels, `${clipId}-${labeler}.json`);
  if (!LABEL_FILE_RE.test(path.basename(labelFile)) || !fs.existsSync(labelFile)) throw new EvalError(`no label file ${clipId}-${labeler}.json`);
  const label = JSON.parse(fs.readFileSync(labelFile, "utf8"));
  if (!label.keyframe_keypoints) throw new EvalError(`${clipId}-${labeler}: no keyframe_keypoints`);
  const poseFile = path.join(derivedDir, `pose-mediapipe-${variant}.json`);
  if (!fs.existsSync(poseFile)) throw new EvalError(`${clipId}: no pose for variant ${variant}`);
  const seq = JSON.parse(fs.readFileSync(poseFile, "utf8"));
  const problems = validatePoseSequence(seq);
  if (problems.length) throw new EvalError(`${clipId}: pose file is malformed: ${problems.join("; ")}`);
  const result = { clipId, labeler, variant, createdOn: today, ...scorePoseAgainstLabels(seq, label.keyframe_keypoints) };
  writeDataJson(layout, path.join(derivedDir, `pose-accuracy-mediapipe-${variant}-${labeler}.json`), result);
  auditEvent(layout, { action: "pose_accuracy_scored_locally", clipId, labeler, variant }, today);
  return result;
}

/** Scores every label file with keyframe_keypoints that has a matching pose; sums raw counts. */
export async function scoreAll(dataDir, { variant = "full", today = todayIso() } = {}) {
  const labelsDir = path.join(dataDir, "labels");
  const total = emptyCounts();
  const byKeypoint = Object.fromEntries(POSE_KEYPOINT_NAMES.map((n) => [n, emptyCounts()]));
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, emptyCounts()]));
  const clips = [];
  const refused = [];
  for (const name of fs.existsSync(labelsDir) ? fs.readdirSync(labelsDir).sort() : []) {
    const m = LABEL_FILE_RE.exec(name);
    if (!m) continue;
    let label;
    try {
      label = JSON.parse(fs.readFileSync(path.join(labelsDir, name), "utf8"));
    } catch {
      refused.push({ file: name, reason: "not valid JSON" });
      continue;
    }
    if (!label.keyframe_keypoints) continue;
    try {
      const r = await scoreClip(dataDir, m[1], m[2], { variant, today });
      add(total, r.raw.overall);
      for (const k of POSE_KEYPOINT_NAMES) add(byKeypoint[k], r.raw.byKeypoint[k]);
      for (const p of PHASES) add(byPhase[p], r.raw.byPhase[p]);
      clips.push({ clipId: m[1], labeler: m[2], framesScored: r.framesScored, pck02: r.overall.pck02 });
    } catch (err) {
      if (!(err instanceof EvalError)) throw err;
      refused.push({ file: name, reason: err.message });
    }
  }
  return {
    variant,
    clips,
    refused,
    overall: finalize(total),
    byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, finalize(v)])),
    byKeypoint: Object.fromEntries(Object.entries(byKeypoint).map(([k, v]) => [k, finalize(v)])),
  };
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { clip: { type: "string" }, labeler: { type: "string" }, variant: { type: "string" }, all: { type: "boolean" } } });
  const variant = values.variant ?? "full";
  const dataDir = defaultDataDir();
  if (values.all) {
    process.stdout.write(`${JSON.stringify(await scoreAll(dataDir, { variant }), null, 2)}\n`);
    return 0;
  }
  if (!values.clip || !values.labeler) throw new EvalError("--clip and --labeler (e.g. K01) are required, or --all");
  const r = await scoreClip(dataDir, values.clip, values.labeler, { variant });
  process.stdout.write(`${JSON.stringify({ clipId: r.clipId, labeler: r.labeler, framesScored: r.framesScored, overall: r.overall, byPhase: r.byPhase }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`pose-accuracy: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      process.exit(1);
    },
  );
}
