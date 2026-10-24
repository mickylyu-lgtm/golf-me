#!/usr/bin/env node
// Caddie V2 checks runner (LOCAL_PILOT_WORKFLOW.md step 7). Reads a derived
// PoseSequence (from pose-local.mjs) and applies the V2 modules that exist
// today, unchanged: the quality gate, the camera-angle heuristic, and the
// key-frame detector with its phase-order check (src/lib/caddie/v2/,
// imported directly via Node's TypeScript type stripping). Writes
// derived/<clip ID>/v2-checks-mediapipe-<variant>.json and the detected key
// frames on their own in derived/<clip ID>/keyframes-mediapipe-<variant>.json
// (the shape lib/keyframeAccuracy.mjs scores against K00 labels).
//
// Every threshold is a PROVISIONAL placeholder (thresholds.ts). The output
// is for scoring against labels, never a result to show anyone as accurate.
// It produces no measurements, faults, explanations, or drills: those
// modules don't exist yet, and the output says so explicitly.
//
// Same gate as the extractor: the clip must pass
// assertLocalProcessingAllowed() (consent active, stripped). Local only; no
// network.
//
// Usage: node tools/caddie-eval/run-v2-checks.mjs --clip C001-0001 [--variant full|heavy]
//        node tools/caddie-eval/run-v2-checks.mjs --all [--variant full]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { CAMERA_ANGLE_VERSION, classifyCameraAngle } from "../../src/lib/caddie/v2/cameraAngle.ts";
import { KEY_FRAMES_VERSION, KEY_FRAME_NAMES, detectKeyFrames, keyFramesToSwingSegments } from "../../src/lib/caddie/v2/keyFrames.ts";
import { PHASE_ORDER_VERSION, analyzedRangeOf, validatePhaseOrder } from "../../src/lib/caddie/v2/phaseOrder.ts";
import { QUALITY_GATE_VERSION, runQualityGate } from "../../src/lib/caddie/v2/qualityGate.ts";
import { CADDIE_V2_THRESHOLDS } from "../../src/lib/caddie/v2/thresholds.ts";
import { POSE_KEYPOINT_NAMES, POSE_SEQUENCE_VERSION } from "../../src/lib/caddie/v2/types.ts";
import { EvalError, PROTOTYPE_CAPABILITIES, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso, writeDataJson } from "./import-clip.mjs";

export { PROTOTYPE_CAPABILITIES };

export const CHECKS_SCHEMA = 2;
export const KEYFRAMES_SCHEMA = 1;

const KEYPOINT_SET = new Set(POSE_KEYPOINT_NAMES);

/** Structural check of an untrusted PoseSequence file. Returns problems (empty = valid). */
export function validatePoseSequence(seq) {
  const problems = [];
  if (typeof seq !== "object" || seq === null || Array.isArray(seq)) return ["not an object"];
  if (seq.version !== POSE_SEQUENCE_VERSION) problems.push("version");
  if (typeof seq.backend !== "string") problems.push("backend");
  if (!["source_pixels", "normalized"].includes(seq.coordinateSpace)) problems.push("coordinateSpace");
  if (!Array.isArray(seq.frames)) return [...problems, "frames"];
  let prevT = -Infinity;
  for (const [i, f] of seq.frames.entries()) {
    if (typeof f !== "object" || f === null || !Number.isInteger(f.frameIndex) || !Number.isFinite(f.timestampSeconds)) {
      problems.push(`frame ${i}: index/timestamp`);
      break;
    }
    if (f.timestampSeconds < prevT) {
      problems.push(`frame ${i}: not sorted by time`);
      break;
    }
    prevT = f.timestampSeconds;
    if (typeof f.keypoints !== "object" || f.keypoints === null) {
      problems.push(`frame ${i}: keypoints`);
      break;
    }
    for (const [name, kp] of Object.entries(f.keypoints)) {
      if (!KEYPOINT_SET.has(name)) {
        problems.push(`frame ${i}: unknown keypoint ${name}`);
        break;
      }
      if (![kp?.x, kp?.y, kp?.confidence].every(Number.isFinite) || kp.confidence < 0 || kp.confidence > 1) {
        problems.push(`frame ${i}: bad keypoint ${name}`);
        break;
      }
    }
    if (problems.length) break;
  }
  return problems;
}

/** frameIndex values where the raw MediaPipe run saw more than one person, or null if unknown. */
export function multiPersonFrames(raw) {
  if (!raw || !Array.isArray(raw.frames)) return null;
  return raw.frames.filter((f) => Array.isArray(f?.poses) && f.poses.length > 1 && Number.isInteger(f.frameIndex)).map((f) => f.frameIndex);
}

/** Applies the V2 checks to one sequence. Pure: no I/O. */
export function runChecks(sequence, { captureIntent = null, multiPersonFrameIndices = null } = {}) {
  const t0 = process.hrtime.bigint();
  const qualityGate = runQualityGate(sequence);
  const cameraAngle = classifyCameraAngle(sequence);
  const handedness = captureIntent?.handedness === "right" || captureIntent?.handedness === "left" ? captureIntent.handedness : null;
  // The heuristic angle, not the manifest's: the detector must work from what it can see.
  const keyFrames = detectKeyFrames(sequence, { handedness, cameraAngle: cameraAngle.angle, multiPersonFrameIndices });
  const phaseOrder = validatePhaseOrder(keyFramesToSwingSegments(keyFrames, sequence), analyzedRangeOf(sequence.frames));
  const runMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const intentAngle = captureIntent?.angle ?? null;
  // The filmer's intent is not ground truth (coach labels are); this is a quick sanity signal only.
  let angleVsIntent = "not_comparable";
  if (intentAngle === "face_on" || intentAngle === "down_the_line") {
    angleVsIntent = cameraAngle.angle === "unknown" ? "unknown" : cameraAngle.angle === intentAngle ? "match" : "mismatch";
  } else if (intentAngle === "unsuitable") {
    angleVsIntent = cameraAngle.angle === "unknown" ? "correctly_unknown" : "claimed_supported_angle";
  }
  const provisional = Object.entries(CADDIE_V2_THRESHOLDS)
    .filter(([, t]) => ["qualityGate", "cameraAngle", "keyFrames", "phaseOrder"].includes(t.module))
    .filter(([, t]) => t.status !== "coach_validated")
    .map(([id]) => id);
  return {
    modules: { qualityGate: QUALITY_GATE_VERSION, cameraAngle: CAMERA_ANGLE_VERSION, keyFrames: KEY_FRAMES_VERSION, phaseOrder: PHASE_ORDER_VERSION },
    thresholdsProvisional: provisional,
    qualityGate,
    cameraAngle,
    keyFrames,
    phaseOrder,
    captureIntent,
    angleVsIntent,
    runMs: Math.round(runMs * 1000) / 1000,
  };
}

/** The detected key frames in the shape lib/keyframeAccuracy.mjs scores: { events: { address: { frame_index, ... } | null, ... } }. */
export function keyframePredictionFile(clipId, variant, sequence, keyFrames, today) {
  const events = {};
  const inconclusive = {};
  for (const name of KEY_FRAME_NAMES) {
    const d = keyFrames.keyFrames[name];
    // "finish" is the annotation guide's name for the same event.
    if (d.status === "detected") events[name] = { frame_index: d.frameIndex, t: d.timestampSeconds, confidence: d.confidence, ...(d.held === undefined ? {} : { held: d.held }) };
    else {
      events[name] = null;
      inconclusive[name] = d.reason;
    }
  }
  return {
    schema: KEYFRAMES_SCHEMA,
    tool: "tools/caddie-eval/run-v2-checks.mjs",
    detector: `keyFrames.ts ${KEY_FRAMES_VERSION}`,
    clipId,
    variant,
    createdOn: today,
    thresholds: "provisional placeholders (src/lib/caddie/v2/thresholds.ts); no accuracy claimed",
    analysisFps: sequence.analysisFps,
    status: keyFrames.status,
    inconclusiveReason: keyFrames.inconclusiveReason,
    events,
    inconclusive,
  };
}

/** Runs the checks for one clip/variant and writes the results file. */
export async function runV2ChecksForClip(dataDir, clipId, { variant = "full", today = todayIso() } = {}) {
  const { entry, derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today, checkFile: false });
  const poseFile = path.join(derivedDir, `pose-mediapipe-${variant}.json`);
  if (!fs.existsSync(poseFile)) throw new EvalError(`${clipId}: no pose for variant ${variant}; run pose-local.mjs first`);
  let sequence;
  try {
    sequence = JSON.parse(fs.readFileSync(poseFile, "utf8"));
  } catch {
    throw new EvalError(`${clipId}: pose file is not valid JSON`);
  }
  const problems = validatePoseSequence(sequence);
  if (problems.length) throw new EvalError(`${clipId}: pose file is malformed: ${problems.join("; ")}`);

  const runFile = path.join(derivedDir, `pose-mediapipe-${variant}.run.json`);
  const extraction = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, "utf8")) : null;
  const captureIntent = { angle: entry.capture?.angle ?? null, handedness: entry.capture?.handedness ?? null, conditions: entry.capture?.conditions ?? [] };
  const rawFile = path.join(derivedDir, `mediapipe-${variant}.raw.json`);
  let multiPersonFrameIndices = null;
  if (fs.existsSync(rawFile)) {
    try {
      multiPersonFrameIndices = multiPersonFrames(JSON.parse(fs.readFileSync(rawFile, "utf8")));
    } catch {
      multiPersonFrameIndices = null; // unreadable raw file: the multi-person check is skipped, not faked
    }
  }
  const checks = runChecks(sequence, { captureIntent, multiPersonFrameIndices });
  const result = {
    schema: CHECKS_SCHEMA,
    tool: "tools/caddie-eval/run-v2-checks.mjs",
    clipId,
    variant,
    createdOn: today,
    prototype: "Local MediaPipe pose + V2 quality gate + camera-angle heuristic + key-frame detector. Provisional thresholds. Not Caddie V1 and not coaching output.",
    multiPersonCheck: multiPersonFrameIndices === null ? "skipped (no raw run file)" : `${multiPersonFrameIndices.length} frames with several people`,
    capabilities: PROTOTYPE_CAPABILITIES,
    pose: {
      backend: sequence.backend,
      backendVersion: sequence.backendVersion,
      frames: sequence.frames.length,
      framesRequested: sequence.framesRequested,
      analysisFps: sequence.analysisFps,
      size: [sequence.sourceWidth, sequence.sourceHeight],
    },
    extraction: extraction
      ? {
          inferenceMsPerFrame: extraction.performance?.inferenceMsPerFrame ?? null,
          wallSecondsTotal: extraction.performance?.wallSecondsTotal ?? null,
          peakRssBytesTotal: extraction.resources?.peakRssBytes?.total ?? null,
          networkBlocked: extraction.network?.blocked ?? null,
        }
      : null,
    ...checks,
  };
  writeDataJson(layout, path.join(derivedDir, `v2-checks-mediapipe-${variant}.json`), result);
  writeDataJson(layout, path.join(derivedDir, `keyframes-mediapipe-${variant}.json`), keyframePredictionFile(clipId, variant, sequence, checks.keyFrames, today));
  auditEvent(layout, { action: "v2_checks_run_locally", clipId, variant }, today);
  return result;
}

/** Runs every clip that has a pose file for the variant; refusals are reported, not thrown. */
export async function runV2ChecksAll(dataDir, { variant = "full", today = todayIso() } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));
  const done = [];
  const refused = [];
  for (const c of manifest.clips) {
    if (!fs.existsSync(path.join(dataDir, "derived", c.clipId, `pose-mediapipe-${variant}.json`))) continue;
    try {
      const r = await runV2ChecksForClip(dataDir, c.clipId, { variant, today });
      done.push({ clipId: c.clipId, gate: r.qualityGate.status, angle: r.cameraAngle.angle, angleVsIntent: r.angleVsIntent, keyFrames: keyFrameSummary(r.keyFrames) });
    } catch (err) {
      if (!(err instanceof EvalError)) throw err;
      refused.push({ clipId: c.clipId, reason: err.message });
    }
  }
  return { variant, done, refused };
}

/** "address 391 (0.98), top 435 (0.98), impact 458 (0.98), finish 496 (0.80)" or the inconclusive reasons. */
export function keyFrameSummary(kf) {
  return KEY_FRAME_NAMES.map((n) => {
    const d = kf.keyFrames[n];
    return d.status === "detected" ? `${n} ${d.frameIndex} (${d.confidence.toFixed(2)}${d.held === false ? ", not held" : ""})` : `${n} inconclusive: ${d.reason}`;
  }).join(", ");
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { clip: { type: "string" }, variant: { type: "string" }, all: { type: "boolean" } } });
  const variant = values.variant ?? "full";
  const dataDir = defaultDataDir();
  if (values.all) {
    process.stdout.write(`${JSON.stringify(await runV2ChecksAll(dataDir, { variant }), null, 2)}\n`);
    return 0;
  }
  if (!values.clip) throw new EvalError("--clip C001-0001 or --all is required");
  const r = await runV2ChecksForClip(dataDir, values.clip, { variant });
  process.stdout.write(
    `${r.clipId} ${variant}: quality gate ${r.qualityGate.status}${r.qualityGate.inconclusiveReason ? ` (${r.qualityGate.inconclusiveReason})` : ""}, ` +
      `usable ${r.qualityGate.usableFrameIndices.length}/${r.qualityGate.totalFrames}; ` +
      `camera angle ${r.cameraAngle.angle}${r.cameraAngle.inconclusiveReason ? ` (${r.cameraAngle.inconclusiveReason})` : ""}; vs filmer intent: ${r.angleVsIntent}\n` +
      `key frames (${r.keyFrames.status}${r.keyFrames.inconclusiveReason ? `: ${r.keyFrames.inconclusiveReason}` : ""}): ${keyFrameSummary(r.keyFrames)}; phase order ${r.phaseOrder.status}\n` +
      "Provisional thresholds, heuristic confidences. Measurements, faults, explanations, drills: not implemented.\n",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`run-v2-checks: ${err instanceof EvalError ? err.message : `unexpected error: ${err?.stack ?? err}`}\n`);
      process.exit(1);
    },
  );
}
