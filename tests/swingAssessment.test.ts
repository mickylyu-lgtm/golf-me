// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSwingAssessment } from "../src/lib/swingAssessment.ts";
import type { SwingAssessmentOptions, SwingSegmentAssessment, SwingSegmentId } from "../src/lib/swingAssessment.ts";
import type { CaddiePoseData, CaddiePoseFrame, CaddiePoseKeypoint, CaddieSwingPhases } from "../src/types/index.ts";

const kp = (x: number, y: number, confidence = 0.9): CaddiePoseKeypoint => ({ x, y, confidence });

// Point at distance `len` from `from`, at `deg` degrees (0 = +x, 90 = +y/down).
function at(from: CaddiePoseKeypoint, len: number, deg: number): CaddiePoseKeypoint {
  const r = (deg * Math.PI) / 180;
  return kp(from.x + len * Math.cos(r), from.y + len * Math.sin(r));
}

// An arm whose elbow angle is exactly `elbowDeg` (180 = straight).
function arm(side: "left" | "right", shoulder: CaddiePoseKeypoint, elbowDeg: number): Record<string, CaddiePoseKeypoint> {
  const elbow = at(shoulder, 50, 90);
  // Upper arm points down from the shoulder (90 deg); the forearm bends away.
  const wrist = at(elbow, 50, 90 + (180 - elbowDeg));
  return { [`${side}_shoulder`]: shoulder, [`${side}_elbow`]: elbow, [`${side}_wrist`]: wrist };
}

// A plain standing body: shoulders y=100, hips y=200, ankles y=400.
function body(overrides: Record<string, CaddiePoseKeypoint | undefined> = {}): Record<string, CaddiePoseKeypoint> {
  const base: Record<string, CaddiePoseKeypoint | undefined> = {
    left_shoulder: kp(140, 100),
    right_shoulder: kp(60, 100),
    left_hip: kp(125, 200),
    right_hip: kp(75, 200),
    left_knee: kp(125, 300),
    right_knee: kp(75, 300),
    left_ankle: kp(125, 400),
    right_ankle: kp(75, 400),
    left_wrist: kp(110, 80),
    right_wrist: kp(90, 80),
    ...overrides,
  };
  return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as Record<string, CaddiePoseKeypoint>;
}

const frame = (t: number, keypoints: Record<string, CaddiePoseKeypoint>): CaddiePoseFrame => ({
  frameIndex: Math.round(t * 8),
  timestampSeconds: t,
  personConfidence: 0.9,
  keypoints,
});

const PHASES: CaddieSwingPhases = {
  address: { timestampSeconds: 0, confidence: "high" },
  backswing: { timestampSeconds: 0.5, confidence: "high" },
  top: { timestampSeconds: 1, confidence: "high" },
  downswing: { timestampSeconds: 1.2, confidence: "high" },
  impact: { windowStartSeconds: 1.45, windowEndSeconds: 1.55, confidence: "high" },
  followThrough: { timestampSeconds: 2, confidence: "high" },
};

function assess(topKeypoints: Record<string, CaddiePoseKeypoint>, options: SwingAssessmentOptions = {}, impactKeypoints = body()) {
  const pose: CaddiePoseData = { analysisFps: 8, frames: [frame(0, body()), frame(1, topKeypoints), frame(1.5, impactKeypoints)] };
  const result = computeSwingAssessment(pose, PHASES, options);
  assert.ok(result);
  const by = (id: SwingSegmentId): SwingSegmentAssessment => result.segments.find((s) => s.segment === id)!;
  return { result, by };
}

// Top of a right-handed backswing: lead (left) arm straight, trail (right) folded.
const RH_TOP = body({ ...arm("left", kp(140, 100), 170), ...arm("right", kp(60, 100), 90) });

test("right-handed top: folded trail arm is NOT flagged, straight lead arm is good", () => {
  const { by } = assess(RH_TOP);
  assert.equal(by("left_arm").status, "good");
  assert.equal(by("right_arm").status, "unknown");
  assert.equal(by("right_arm").reliabilityReason, "not_applicable");
});

test("left-handed top: mirror image — left arm folded is not flagged", () => {
  const { by } = assess(body({ ...arm("left", kp(140, 100), 85), ...arm("right", kp(60, 100), 165) }));
  assert.equal(by("right_arm").status, "good");
  assert.equal(by("left_arm").reliabilityReason, "not_applicable");
});

test("bent lead arm is still flagged (the straighter arm is judged)", () => {
  const { by } = assess(body({ ...arm("left", kp(140, 100), 120), ...arm("right", kp(60, 100), 90) }));
  assert.equal(by("left_arm").status, "needs_improvement");
  assert.equal(by("right_arm").reliabilityReason, "not_applicable");
});

test("handedness option picks the lead arm explicitly", () => {
  const { by } = assess(RH_TOP, { handedness: "left" });
  // Left-handed: right arm is lead and it is folded at 90 -> flagged.
  assert.equal(by("right_arm").status, "needs_improvement");
  assert.equal(by("left_arm").reliabilityReason, "not_applicable");
});

test("never more than one arm carries a verdict", () => {
  for (const [l, r] of [[170, 170], [90, 90], [170, 90], [140, 140]]) {
    const { by } = assess(body({ ...arm("left", kp(140, 100), l), ...arm("right", kp(60, 100), r) }));
    const judged = [by("left_arm"), by("right_arm")].filter((s) => s.status !== "unknown");
    assert.ok(judged.length <= 1, `${l}/${r}`);
  }
});

test("only one arm visible: straight is credited, bent is not attributed", () => {
  const straight = assess(body({ ...arm("left", kp(140, 100), 170), right_elbow: undefined, right_wrist: undefined }));
  assert.equal(straight.by("left_arm").status, "good");
  const bent = assess(body({ ...arm("right", kp(60, 100), 90), left_elbow: undefined, left_wrist: undefined }));
  assert.equal(bent.by("right_arm").status, "unknown");
  assert.notEqual(bent.by("right_arm").reliabilityReason, "not_applicable");
});

test("hip sway: judged face-on only", () => {
  const swayed = body({ left_hip: kp(175, 200), right_hip: kp(125, 200) }); // hips slid 50 px = 0.625 shoulder widths
  assert.equal(assess(RH_TOP, { cameraAngle: "face_on" }, swayed).by("hip_sway").status, "needs_improvement");
  for (const cameraAngle of ["down_the_line", "other", "uncertain", undefined] as const) {
    const s = assess(RH_TOP, { cameraAngle }, swayed).by("hip_sway");
    assert.equal(s.status, "unknown", String(cameraAngle));
    assert.equal(s.reliabilityReason, "not_applicable");
  }
});

test("knees: judged down the line only (face-on hides knee flex)", () => {
  // Default body has perfectly straight legs.
  assert.equal(assess(RH_TOP, { cameraAngle: "down_the_line" }).by("knees").status, "needs_improvement");
  for (const cameraAngle of ["face_on", "other", "uncertain", undefined] as const) {
    assert.equal(assess(RH_TOP, { cameraAngle }).by("knees").reliabilityReason, "not_applicable", String(cameraAngle));
  }
});

test("shoulder line: skipped down the line, judged otherwise", () => {
  assert.equal(assess(RH_TOP, { cameraAngle: "down_the_line" }).by("shoulder_line").reliabilityReason, "not_applicable");
  assert.equal(assess(RH_TOP, { cameraAngle: "face_on" }).by("shoulder_line").status, "good");
});

test("still one entry per segment id", () => {
  const { result } = assess(RH_TOP);
  assert.deepEqual(
    result.segments.map((s) => s.segment).sort(),
    ["hip_sway", "knees", "left_arm", "right_arm", "shoulder_line", "torso", "wrists"],
  );
});
