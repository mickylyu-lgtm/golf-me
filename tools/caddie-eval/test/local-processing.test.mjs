// node --test tools/caddie-eval/test/*.test.mjs
// The local-processing gate, the V2-checks runner, the overlay drawing, and
// pose-accuracy scoring, on synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EvalError, assertLocalProcessingAllowed, withdrawContributor } from "../import-clip.mjs";
import { PROTOTYPE_CAPABILITIES, runChecks, runV2ChecksAll, runV2ChecksForClip, validatePoseSequence } from "../run-v2-checks.mjs";
import { drawPoseFrame } from "../render-overlay.mjs";
import { scoreClip, scorePoseAgainstLabels, validateKeyframeLabels } from "../pose-accuracy.mjs";
import { POSES, TODAY, setupWithClip, writeSyntheticPose } from "./helpers.mjs";

test("local gate: passes a consented, stripped, intact clip and returns its derived folder", async () => {
  const { dataDir, clipId } = await setupWithClip();
  const r = await assertLocalProcessingAllowed(dataDir, clipId, { today: TODAY });
  assert.equal(r.entry.clipId, clipId);
  assert.equal(r.derivedDir, path.join(fs.realpathSync(dataDir), "derived", clipId));
  assert.ok(fs.existsSync(r.file));
});

test("local gate: refuses unknown IDs, unstripped clips, tampered files, withdrawn or expired consent", async () => {
  const { dataDir, clipId } = await setupWithClip();
  await assert.rejects(assertLocalProcessingAllowed(dataDir, "C001-9999", { today: TODAY }), /not in the manifest/);
  await assert.rejects(assertLocalProcessingAllowed(dataDir, "../etc", { today: TODAY }), /must look like/);
  await assert.rejects(assertLocalProcessingAllowed(dataDir, clipId, { today: "2027-01-18" }), /retention date/);

  const clipFile = path.join(dataDir, "clips", `${clipId}.mov`);
  fs.appendFileSync(clipFile, "tampered");
  await assert.rejects(assertLocalProcessingAllowed(dataDir, clipId, { today: TODAY }), /sha256 mismatch/);

  const un = await setupWithClip({ strippedManually: false });
  await assert.rejects(assertLocalProcessingAllowed(un.dataDir, un.clipId, { today: TODAY }), /audio\/metadata/);

  const w = await setupWithClip();
  withdrawContributor(w.dataDir, "C001", { confirm: true }, TODAY);
  await assert.rejects(assertLocalProcessingAllowed(w.dataDir, w.clipId, { today: TODAY }), /not in the manifest/);
});

test("withdrawal deletes everything derived for the clip (pose, checks, overlay)", async () => {
  const { dataDir, clipId } = await setupWithClip();
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  await runV2ChecksForClip(dataDir, clipId, { today: TODAY });
  fs.writeFileSync(path.join(dataDir, "derived", clipId, "overlay-mediapipe-full.mp4"), "x");
  withdrawContributor(dataDir, "C001", { confirm: true }, TODAY);
  assert.ok(!fs.existsSync(path.join(dataDir, "derived", clipId)));
});

test("runner: face-on synthetic pose passes the gate and reads face_on; output states what isn't implemented", async () => {
  const { dataDir, clipId } = await setupWithClip({ angle: "face_on" });
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  const r = await runV2ChecksForClip(dataDir, clipId, { today: TODAY });
  assert.equal(r.qualityGate.status, "pass");
  assert.equal(r.cameraAngle.angle, "face_on");
  assert.equal(r.angleVsIntent, "match");
  for (const k of ["swing_phases", "measurements", "faults", "coaching_explanations", "drills"]) assert.equal(r.capabilities[k], "not implemented");
  assert.deepEqual(r.capabilities, PROTOTYPE_CAPABILITIES);
  assert.ok(r.thresholdsProvisional.includes("QG_MIN_KEYPOINT_CONFIDENCE"));
  assert.ok(r.thresholdsProvisional.includes("CA_MIN_AGREEMENT"));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "derived", clipId, "v2-checks-mediapipe-full.json"), "utf8"));
  assert.equal(onDisk.clipId, clipId);
  assert.ok(!JSON.stringify(onDisk).includes(dataDir), "no absolute paths in results");
  const log = fs.readFileSync(path.join(dataDir, "audit-log.jsonl"), "utf8");
  assert.ok(log.includes("v2_checks_run_locally"));
});

test("runner: a DTL pose filmed as face-on is reported as a mismatch; an unsuitable clip is checked for abstention", async () => {
  const a = await setupWithClip({ angle: "face_on" });
  writeSyntheticPose(a.dataDir, a.clipId, POSES.DTL_ADDRESS);
  assert.equal((await runV2ChecksForClip(a.dataDir, a.clipId, { today: TODAY })).angleVsIntent, "mismatch");
  const b = await setupWithClip({ angle: "unsuitable" });
  writeSyntheticPose(b.dataDir, b.clipId, POSES.DTL_ADDRESS);
  assert.equal((await runV2ChecksForClip(b.dataDir, b.clipId, { today: TODAY })).angleVsIntent, "claimed_supported_angle");
});

test("runner: mostly no-pose frames make the gate inconclusive and the angle unknown", async () => {
  const { dataDir, clipId } = await setupWithClip();
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS, { frames: 12, noPoseFrames: 10 });
  const r = await runV2ChecksForClip(dataDir, clipId, { today: TODAY });
  assert.equal(r.qualityGate.status, "inconclusive");
  assert.equal(r.qualityGate.rejectCounts.no_person, 10);
  assert.equal(r.cameraAngle.angle, "unknown");
});

test("runner: refuses a missing or malformed pose file, and a clip whose consent lapsed", async () => {
  const { dataDir, clipId } = await setupWithClip();
  await assert.rejects(runV2ChecksForClip(dataDir, clipId, { today: TODAY }), /run pose-local/);
  const dir = path.join(dataDir, "derived", clipId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pose-mediapipe-full.json"), "{not json");
  await assert.rejects(runV2ChecksForClip(dataDir, clipId, { today: TODAY }), /not valid JSON/);
  fs.writeFileSync(path.join(dir, "pose-mediapipe-full.json"), JSON.stringify({ version: 1, backend: "x", coordinateSpace: "source_pixels", frames: [{ frameIndex: 0, timestampSeconds: 0, keypoints: { elbow_of_doom: { x: 1, y: 1, confidence: 1 } } }] }));
  await assert.rejects(runV2ChecksForClip(dataDir, clipId, { today: TODAY }), /unknown keypoint/);
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  await assert.rejects(runV2ChecksForClip(dataDir, clipId, { today: "2027-02-01" }), /retention date/);
});

test("runner --all: runs clips that have a pose and reports refusals", async () => {
  const { dataDir, clipId } = await setupWithClip();
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  const all = await runV2ChecksAll(dataDir, { today: TODAY });
  assert.deepEqual(all.done.map((d) => d.clipId), [clipId]);
  assert.deepEqual(all.refused, []);
});

test("validatePoseSequence and runChecks are pure and strict", () => {
  assert.deepEqual(validatePoseSequence(null), ["not an object"]);
  assert.ok(validatePoseSequence({ version: 1, backend: "b", coordinateSpace: "normalized", frames: [{ frameIndex: 1, timestampSeconds: 1, keypoints: {} }, { frameIndex: 0, timestampSeconds: 0, keypoints: {} }] }).some((p) => p.includes("not sorted")));
  const r = runChecks({ version: 1, backend: "synthetic", backendVersion: null, coordinateSpace: "source_pixels", sourceWidth: 1, sourceHeight: 1, analysisFps: 30, framesRequested: 0, frames: [] });
  assert.equal(r.qualityGate.inconclusiveReason, "empty_sequence");
  assert.equal(r.angleVsIntent, "not_comparable");
});

test("overlay drawing: draws confident keypoints only and borders unusable frames", () => {
  const w = 64;
  const h = 64;
  const rgba = Buffer.alloc(w * h * 4);
  const kp = (x, y, confidence = 0.9) => ({ x, y, confidence });
  const frame = {
    frameIndex: 0,
    timestampSeconds: 0,
    personConfidence: null,
    keypoints: { left_shoulder: kp(20, 20), left_elbow: kp(20, 40), right_shoulder: kp(44, 20, 0.05) },
  };
  const r = drawPoseFrame(rgba, w, h, frame);
  assert.equal(r.drawnKeypoints, 2);
  assert.equal(r.usable, false);
  const px = (x, y) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
  assert.deepEqual(px(20, 30), [0, 220, 255], "left-side bone drawn cyan");
  assert.deepEqual(px(44, 20), [0, 0, 0], "low-confidence keypoint not drawn");
  assert.deepEqual(px(0, 0), [230, 30, 30], "unusable frame gets a red border");
});

function keyframeLabels(points, { offset = 0, notVisible = [] } = {}) {
  // Label space = the analyzed frame scaled 1.5x (1080x1920), as a phone frame would be.
  const p = {};
  for (const [name, [x, y]] of Object.entries(points)) {
    p[name] = notVisible.includes(name) ? "not_visible" : [(200 + x * 2) * 1.5 + offset, (300 + y * 2) * 1.5];
  }
  return { frame_width: 1080, frame_height: 1920, frames: [{ phase: "address", t: 0.1, points: p }] };
}

test("pose accuracy: perfect labels score PCK 1, shifted labels fail, not_visible tracks false observations", async () => {
  const { dataDir, clipId } = await setupWithClip();
  const seq = writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  const perfect = scorePoseAgainstLabels(seq, keyframeLabels(POSES.FACE_ON_ADDRESS));
  assert.equal(perfect.framesScored, 1);
  assert.equal(perfect.overall.pck02, 1);
  assert.equal(perfect.overall.meanNormalizedErrorWhenPredicted, 0);

  const shifted = scorePoseAgainstLabels(seq, keyframeLabels(POSES.FACE_ON_ADDRESS, { offset: 400 }));
  assert.equal(shifted.overall.pck02, 0);
  assert.equal(shifted.overall.confidentWrongRate, 1);
  assert.equal(perfect.overall.confidentWrongRate, 0);

  const hidden = scorePoseAgainstLabels(seq, keyframeLabels(POSES.FACE_ON_ADDRESS, { notVisible: ["left_wrist", "right_wrist"] }));
  assert.equal(hidden.overall.labeledNotVisible, 2);
  assert.equal(hidden.overall.falseObservationRate, 1, "the synthetic pose reports both wrists confidently");
  assert.equal(hidden.overall.honestAbstention, 0);
  assert.equal(hidden.byKeypoint.left_wrist.labeledVisible, 0);
});

test("pose accuracy: skips frames without a nearby pose frame or torso diagonals; rejects bad labels", async () => {
  const { dataDir, clipId } = await setupWithClip();
  const seq = writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  const far = keyframeLabels(POSES.FACE_ON_ADDRESS);
  far.frames[0].t = 5;
  assert.equal(scorePoseAgainstLabels(seq, far).skipped[0].reason, "no pose frame within half a frame of t");
  const noTorso = keyframeLabels(POSES.FACE_ON_ADDRESS, { notVisible: ["left_hip"] });
  assert.equal(scorePoseAgainstLabels(seq, noTorso).framesScored, 0);
  assert.ok(validateKeyframeLabels({ frame_width: 1, frame_height: 1, frames: [{ phase: "swing", t: 0, points: {} }] }).length > 0);
  const rotated = { ...keyframeLabels(POSES.FACE_ON_ADDRESS), frame_width: 1920, frame_height: 1080 };
  assert.throws(() => scorePoseAgainstLabels(seq, rotated), /aspect ratio/);
});

test("pose accuracy CLI path: reads labels/<clip>-<labeler>.json and writes results under derived/", async () => {
  const { dataDir, clipId } = await setupWithClip();
  writeSyntheticPose(dataDir, clipId, POSES.FACE_ON_ADDRESS);
  fs.writeFileSync(path.join(dataDir, "labels", `${clipId}-K01.json`), JSON.stringify({ clip_id: clipId, coach_id: "K01", keyframe_keypoints: keyframeLabels(POSES.FACE_ON_ADDRESS) }));
  const r = await scoreClip(dataDir, clipId, "K01", { today: TODAY });
  assert.equal(r.overall.pck02, 1);
  assert.ok(fs.existsSync(path.join(dataDir, "derived", clipId, "pose-accuracy-mediapipe-full-K01.json")));
  await assert.rejects(scoreClip(dataDir, clipId, "K02", { today: TODAY }), EvalError);
});

test("pass-2 prototype ratings: only implemented capabilities can be rated; the rest must say not_implemented", async () => {
  const { validateLabelRecord, PROTOTYPE_RATING_FIELDS, isImplemented } = await import("../import-clip.mjs");
  const base = { clip_id: "C001-0001", coach_id: "K01", p2_prototype: "mediapipe-full" };
  const good = {
    ...base,
    p2_landmark_rating: "mostly_reliable",
    p2_landmark_problem_phases: "downswing wrists",
    p2_phase_rating: "not_implemented",
    p2_measurement_rating: "not_implemented",
    p2_fault_rating: "not_implemented",
    p2_explanation_rating: "not_implemented",
    p2_drill_rating: "not_implemented",
  };
  assert.deepEqual(validateLabelRecord(good, { clipId: "C001-0001", coachId: "K01" }), []);
  assert.ok(isImplemented("body_landmarks"));
  for (const f of ["p2_phase_rating", "p2_measurement_rating", "p2_fault_rating", "p2_explanation_rating", "p2_drill_rating"]) {
    assert.ok(!isImplemented(PROTOTYPE_RATING_FIELDS[f].capability), `${f} capability is not implemented today`);
    const p = validateLabelRecord({ ...good, [f]: "correct" });
    assert.ok(p.some((x) => x.includes(f) && x.includes("not_implemented")), `${f}: a rating of missing output is refused`);
  }
  assert.ok(validateLabelRecord({ ...good, p2_landmark_rating: "not_implemented" }).some((x) => x.includes("p2_landmark_rating must be one of")));
  const { p2_prototype: _omit, ...noProto } = good;
  assert.ok(validateLabelRecord(noProto).some((x) => x.includes("p2_prototype")));
});
