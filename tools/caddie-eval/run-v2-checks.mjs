#!/usr/bin/env node
// Caddie V2 checks runner (LOCAL_PILOT_WORKFLOW.md step 7). Reads a derived
// PoseSequence (from pose-local.mjs) and applies the V2 modules that exist
// today, unchanged: the quality gate and the camera-angle heuristic
// (src/lib/caddie/v2/, imported directly via Node's TypeScript type
// stripping). Writes derived/<clip ID>/v2-checks-mediapipe-<variant>.json.
//
// Every threshold is a PROVISIONAL placeholder (thresholds.ts). The output
// is for scoring against coach labels, never a result to show anyone as
// accurate. It produces no phases, measurements, faults, explanations, or
// drills: those modules don't exist yet, and the output says so explicitly.
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
import { QUALITY_GATE_VERSION, runQualityGate } from "../../src/lib/caddie/v2/qualityGate.ts";
import { CADDIE_V2_THRESHOLDS } from "../../src/lib/caddie/v2/thresholds.ts";
import { POSE_KEYPOINT_NAMES, POSE_SEQUENCE_VERSION } from "../../src/lib/caddie/v2/types.ts";
import { EvalError, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso, writeDataJson } from "./import-clip.mjs";

export const CHECKS_SCHEMA = 1;

/**
 * What the local prototype does and does not produce, stated in every
 * results file so a rating sheet can never imply more than exists.
 */
export const PROTOTYPE_CAPABILITIES = Object.freeze({
  body_landmarks: "implemented (MediaPipe Pose Landmarker, 13 keypoints)",
  quality_gate: "implemented (provisional thresholds)",
  camera_angle: "implemented (provisional heuristic; face_on / down_the_line / unknown)",
  swing_phases: "not implemented",
  measurements: "not implemented",
  faults: "not implemented",
  coaching_explanations: "not implemented",
  drills: "not implemented",
});

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

/** Applies the V2 checks to one sequence. Pure: no I/O. */
export function runChecks(sequence, { captureIntent = null } = {}) {
  const t0 = process.hrtime.bigint();
  const qualityGate = runQualityGate(sequence);
  const cameraAngle = classifyCameraAngle(sequence);
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
    .filter(([, t]) => t.module === "qualityGate" || t.module === "cameraAngle")
    .filter(([, t]) => t.status !== "coach_validated")
    .map(([id]) => id);
  return {
    modules: { qualityGate: QUALITY_GATE_VERSION, cameraAngle: CAMERA_ANGLE_VERSION },
    thresholdsProvisional: provisional,
    qualityGate,
    cameraAngle,
    captureIntent,
    angleVsIntent,
    runMs: Math.round(runMs * 1000) / 1000,
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
  const checks = runChecks(sequence, { captureIntent });
  const result = {
    schema: CHECKS_SCHEMA,
    tool: "tools/caddie-eval/run-v2-checks.mjs",
    clipId,
    variant,
    createdOn: today,
    prototype: "Local MediaPipe pose + V2 quality gate + camera-angle heuristic. Provisional thresholds. Not Caddie V1 and not coaching output.",
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
      done.push({ clipId: c.clipId, gate: r.qualityGate.status, angle: r.cameraAngle.angle, angleVsIntent: r.angleVsIntent });
    } catch (err) {
      if (!(err instanceof EvalError)) throw err;
      refused.push({ clipId: c.clipId, reason: err.message });
    }
  }
  return { variant, done, refused };
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
      "Provisional thresholds. Phases, measurements, faults, explanations, drills: not implemented.\n",
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
