#!/usr/bin/env node
// Pose accuracy of the local pose source against hand-marked key-frame
// keypoints (TESTING_PROTOCOL.md §8 "Key-frame keypoints"). Local only.
//
// Label sources:
// - K00 (Micky, PROTOTYPE labels, not validated ground truth): the latest
//   valid version of annotations/<clip>-K00.vNNN.json (lib/annotations.mjs,
//   docs/caddie-v2/KEYFRAME_ANNOTATION_GUIDE.md), converted to the shape below;
// - a coach (K01, K02): the `keyframe_keypoints` field of labels/<clip>-<coach>.json:
//   { "frame_width": 1080, "frame_height": 1920,   // pixel size the points were marked in (as displayed, upright)
//     "frames": [ { "phase": "address" | "top" | "impact" | "finish", "t": 1.234,
//                   "points": { "left_shoulder": [x, y] | { "occluded": [x, y] } | "not_visible", ... } } ] }
// Points use the GOLFER's anatomical left/right. A point left out = not labeled.
// "occluded" = partly hidden, position estimated: scored in its own columns,
// never mixed into PCK, which uses clearly visible points only.
//
// Metric (EVAL_REPORT_TEMPLATE.md §5):
// - error = 2-D distance / torso length, where torso length = labeled
//   shoulder midpoint to hip midpoint in that frame (frame not scorable
//   unless both shoulders and both hips have a position, visible or
//   occluded-estimate; frames using an estimate are counted). The BlazePose
//   model card normalizes by torso DIAMETER instead, so its PDJ numbers are
//   not directly comparable;
// - a prediction counts only if its confidence passes the quality gate's
//   keypoint threshold; a missing prediction for a visible label is a miss;
// - PCK@0.1 and PCK@0.2 per keypoint, per phase, overall;
// - abstention: for "not_visible" labels, how often the model still reported
//   a confident point (false observation); confident-wrong as in the template.
// The pose frame used is the one nearest to t, within half a frame interval.
//
// Key frames (K00 annotations only, which carry frame indices): when
// run-v2-checks.mjs wrote derived/<clip>/keyframes-mediapipe-<variant>.json,
// the detector's frames are also scored against K00's (lib/keyframeAccuracy.mjs:
// error in frames and ms, within ±67 ms, within ±1 frame; an inconclusive
// prediction for a labeled key frame is a miss).
//
// Usage: node tools/caddie-eval/pose-accuracy.mjs --clip C001-0001 --labeler K00|K01 [--variant full]
//        node tools/caddie-eval/pose-accuracy.mjs --all [--variant full]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { QG_MIN_KEYPOINT_CONFIDENCE } from "../../src/lib/caddie/v2/qualityGate.ts";
import { POSE_KEYPOINT_NAMES } from "../../src/lib/caddie/v2/types.ts";
import { EvalError, LABEL_FILE_RE, assertLocalProcessingAllowed, auditEvent, defaultDataDir, todayIso, writeDataJson } from "./import-clip.mjs";
import { validatePoseSequence } from "./run-v2-checks.mjs";
import { ANNOTATION_LABEL_STATUS, ANNOTATOR_IDS, KEYFRAME_EVENTS, annotationToScorerLabels, readAnnotationChain } from "./lib/annotations.mjs";
import { scoreKeyframePredictions } from "./lib/keyframeAccuracy.mjs";

export const POSE_ACCURACY_VERSION = "0.3.0";
export const PHASES = ["address", "top", "impact", "finish"];

function emptyCounts() {
  return {
    labeledVisible: 0,
    predicted: 0,
    within01: 0,
    within02: 0,
    confidentFar: 0,
    errorSum: 0,
    labeledNotVisible: 0,
    falseObservations: 0,
    labeledOccluded: 0,
    occludedPredicted: 0,
    occludedWithin02: 0,
  };
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
    // Occluded (estimated) labels, reported separately: how often the model reports them confidently, and how close.
    occludedConfidentRate: c.labeledOccluded ? r(c.occludedPredicted / c.labeledOccluded) : null,
    occludedPck02: c.labeledOccluded ? r(c.occludedWithin02 / c.labeledOccluded) : null,
  };
}

const isXY = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const positionOf = (v) => (isXY(v) ? v : v && typeof v === "object" && isXY(v.occluded) ? v.occluded : null);

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
      else if (v !== "not_visible" && !isXY(v) && !(v && typeof v === "object" && isXY(v.occluded) && Object.keys(v).length === 1)) problems.push(`frames[${i}].${name}`);
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
  const names = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"];
  const [ls, rs, lh, rh] = names.map((n) => positionOf(points[n]));
  if (!ls || !rs || !lh || !rh) return null;
  const d = Math.hypot((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2);
  return d > 0 ? { length: d, usedEstimate: names.some((n) => !isXY(points[n])) } : null;
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
  let framesTorsoFromEstimate = 0;
  for (const lf of labels.frames) {
    const pf = nearestFrame(sequence, lf.t);
    if (!pf) {
      skipped.push({ phase: lf.phase, t: lf.t, reason: "no pose frame within half a frame of t" });
      continue;
    }
    const torso = torsoLength(lf.points);
    if (torso === null) {
      skipped.push({ phase: lf.phase, t: lf.t, reason: "both shoulders and both hips need a labeled position" });
      continue;
    }
    if (torso.usedEstimate) framesTorsoFromEstimate++;
    for (const [name, v] of Object.entries(lf.points)) {
      const c = emptyCounts();
      const kp = pf.keypoints[name];
      const confident = kp && kp.confidence >= minConfidence ? kp : null;
      if (v === "not_visible") {
        c.labeledNotVisible = 1;
        if (confident) c.falseObservations = 1;
      } else if (!isXY(v)) {
        c.labeledOccluded = 1;
        if (confident) {
          c.occludedPredicted = 1;
          if (Math.hypot(confident.x * sx - v.occluded[0], confident.y * sy - v.occluded[1]) / torso.length <= 0.2) c.occludedWithin02 = 1;
        }
      } else {
        c.labeledVisible = 1;
        if (confident) {
          c.predicted = 1;
          const err = Math.hypot(confident.x * sx - v[0], confident.y * sy - v[1]) / torso.length;
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
    framesTorsoFromEstimate,
    skipped,
    overall: finalize(overall),
    byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, finalize(v)])),
    byKeypoint: Object.fromEntries(Object.entries(byKeypoint).map(([k, v]) => [k, finalize(v)])),
    raw: { overall, byPhase, byKeypoint },
  };
}

/**
 * The key-frame labels for one clip and labeler, in the scorer's shape, plus
 * where they came from. K00 = latest valid annotation version (prototype).
 */
export function loadKeyframeLabels(layout, clipId, labeler) {
  if (ANNOTATOR_IDS.includes(labeler)) {
    const chain = readAnnotationChain(layout.annotations, clipId, labeler);
    if (chain.problems.length) throw new EvalError(`${clipId}-${labeler} annotations are invalid: ${chain.problems.join("; ")}`);
    if (!chain.latest) throw new EvalError(`no annotation ${clipId}-${labeler}.v001.json`);
    return {
      annotation: chain.latest,
      labels: annotationToScorerLabels(chain.latest),
      source: { kind: "prototype_annotation", labelStatus: ANNOTATION_LABEL_STATUS, annotatorId: labeler, version: chain.latest.version, versions: chain.versions.length },
    };
  }
  const labelFile = path.join(layout.labels, `${clipId}-${labeler}.json`);
  if (!LABEL_FILE_RE.test(path.basename(labelFile)) || !fs.existsSync(labelFile)) throw new EvalError(`no label file ${clipId}-${labeler}.json`);
  const label = JSON.parse(fs.readFileSync(labelFile, "utf8"));
  if (!label.keyframe_keypoints) throw new EvalError(`${clipId}-${labeler}: no keyframe_keypoints`);
  return { labels: label.keyframe_keypoints, source: { kind: "coach_label", coachId: labeler } };
}

/**
 * Detector key frames vs a K00 annotation, or a reason string when not
 * scorable (coach labels carry no frame index; no detector output; fps differ).
 */
export function keyFrameErrorFor(derivedDir, variant, annotation) {
  if (!annotation) return "not scored: coach labels carry no key-frame indices";
  const file = path.join(derivedDir, `keyframes-mediapipe-${variant}.json`);
  if (!fs.existsSync(file)) return "not scored: no detector output (run run-v2-checks.mjs)";
  const predicted = JSON.parse(fs.readFileSync(file, "utf8"));
  const labelFps = annotation.frame_source.analysis_fps;
  if (Number.isFinite(predicted.analysisFps) && Math.abs(predicted.analysisFps - labelFps) / labelFps > 0.01) {
    return `not scored: label fps ${labelFps} differs from pose fps ${predicted.analysisFps}`;
  }
  return scoreKeyframePredictions(predicted, annotation);
}

export async function scoreClip(dataDir, clipId, labeler, { variant = "full", today = todayIso() } = {}) {
  const { derivedDir, layout } = await assertLocalProcessingAllowed(dataDir, clipId, { today, checkFile: false });
  const { labels, source, annotation } = loadKeyframeLabels(layout, clipId, labeler);
  const poseFile = path.join(derivedDir, `pose-mediapipe-${variant}.json`);
  if (!fs.existsSync(poseFile)) throw new EvalError(`${clipId}: no pose for variant ${variant}`);
  const seq = JSON.parse(fs.readFileSync(poseFile, "utf8"));
  const problems = validatePoseSequence(seq);
  if (problems.length) throw new EvalError(`${clipId}: pose file is malformed: ${problems.join("; ")}`);
  const result = { clipId, labeler, labelSource: source, variant, createdOn: today, ...scorePoseAgainstLabels(seq, labels), keyFrameError: keyFrameErrorFor(derivedDir, variant, annotation) };
  writeDataJson(layout, path.join(derivedDir, `pose-accuracy-mediapipe-${variant}-${labeler}.json`), result);
  auditEvent(layout, { action: "pose_accuracy_scored_locally", clipId, labeler, variant }, today);
  return result;
}

/** Scores every label file with keyframe_keypoints that has a matching pose; sums raw counts. */
export async function scoreAll(dataDir, { variant = "full", today = todayIso() } = {}) {
  const labelsDir = path.join(dataDir, "labels");
  const annotationsDir = path.join(dataDir, "annotations");
  const total = emptyCounts();
  const byKeypoint = Object.fromEntries(POSE_KEYPOINT_NAMES.map((n) => [n, emptyCounts()]));
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, emptyCounts()]));
  const clips = [];
  const refused = [];
  const pairs = [];
  const keyFrames = Object.fromEntries(KEYFRAME_EVENTS.map((e) => [e, { labeled: 0, predicted: 0, withinTolerance: 0, withinOneFrame: 0, errorsFrames: [], errorsMs: [], signedErrorsFrames: [] }]));
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
    if (label.keyframe_keypoints) pairs.push([m[1], m[2], name]);
  }
  const seen = new Set();
  for (const name of fs.existsSync(annotationsDir) ? fs.readdirSync(annotationsDir).sort() : []) {
    const m = /^(C\d{3}-\d{4})-(K\d{2})\.v\d{3}\.json$/.exec(name);
    if (!m || seen.has(`${m[1]}-${m[2]}`)) continue;
    seen.add(`${m[1]}-${m[2]}`);
    pairs.push([m[1], m[2], `${m[1]}-${m[2]} (annotations, latest version)`]);
  }
  for (const [clipId, labeler, name] of pairs) {
    try {
      const r = await scoreClip(dataDir, clipId, labeler, { variant, today });
      add(total, r.raw.overall);
      for (const k of POSE_KEYPOINT_NAMES) add(byKeypoint[k], r.raw.byKeypoint[k]);
      for (const p of PHASES) add(byPhase[p], r.raw.byPhase[p]);
      if (typeof r.keyFrameError === "object" && r.keyFrameError) {
        for (const e of KEYFRAME_EVENTS) {
          const row = r.keyFrameError.byEvent[e];
          for (const k of ["labeled", "predicted", "withinTolerance", "withinOneFrame"]) keyFrames[e][k] += row[k];
          keyFrames[e].errorsFrames.push(...row.errorsFrames);
          keyFrames[e].errorsMs.push(...row.errorsMs);
          keyFrames[e].signedErrorsFrames.push(...row.signedErrorsFrames);
        }
      }
      clips.push({ clipId, labeler, labelSource: r.labelSource, framesScored: r.framesScored, pck02: r.overall.pck02, keyFramesScored: typeof r.keyFrameError === "object" });
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
    keyFrames,
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
  process.stdout.write(`${JSON.stringify({ clipId: r.clipId, labeler: r.labeler, framesScored: r.framesScored, overall: r.overall, byPhase: r.byPhase, keyFrameError: r.keyFrameError }, null, 2)}\n`);
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
