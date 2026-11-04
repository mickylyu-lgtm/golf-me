// Run: npm run test:caddie  (node --test, built-in type stripping)
// The measured-verdict check analyze-swing and translate-caddie-analysis
// run on Gemini's checkpoint cues (supabase/functions/_shared/caddieVerdicts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cueBodyParts,
  cueContradictsFaults,
  measuredAssessment,
  measuredFaultsByPhase,
  phasesFromJson,
  poseDataFromJson,
  withMeasuredCueCheck,
} from "../supabase/functions/_shared/caddieVerdicts.ts";
import { computeSwingAssessment } from "../src/lib/swingAssessment.ts";

type Kp = { x: number; y: number; confidence: number };
const kp = (x: number, y: number, confidence = 0.9): Kp => ({ x, y, confidence });
const at = (from: Kp, len: number, deg: number): Kp => {
  const r = (deg * Math.PI) / 180;
  return kp(from.x + len * Math.cos(r), from.y + len * Math.sin(r));
};

// Standing body, face-on: shoulders y=100 (80 wide), hips y=200.
function body(overrides: Record<string, Kp> = {}): Record<string, Kp> {
  return {
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
}

// Arms raised (hands above the shoulders, so hand height reads "good"),
// with the given elbow angles. The straighter arm is the lead arm.
function topBody(leftElbowDeg: number, rightElbowDeg: number): Record<string, Kp> {
  const arm = (side: "left" | "right", shoulder: Kp, deg: number) => {
    const elbow = at(shoulder, 50, 270);
    const wrist = at(elbow, 50, 270 + (180 - deg));
    return { [`${side}_elbow`]: elbow, [`${side}_wrist`]: wrist };
  };
  const base = body();
  return { ...base, ...arm("left", base.left_shoulder, leftElbowDeg), ...arm("right", base.right_shoulder, rightElbowDeg) };
}

const frame = (i: number, t: number, keypoints: Record<string, Kp>) => ({ frame_index: i, timestamp_seconds: t, person_confidence: 0.9, keypoints, body_metrics: {} });

// Stored shapes, exactly as analyze-swing writes them.
function poseJson(top: Record<string, Kp>, impact: Record<string, Kp> = body()) {
  return {
    video: { analysis_fps: 8 },
    frames: [frame(0, 0.5, body()), frame(1, 1.0, top), frame(2, 1.35, impact), frame(3, 1.8, body())],
    limitations: [],
  };
}
const phases = {
  address: { timestamp_seconds: 0.5, confidence: "high" },
  backswing: { timestamp_seconds: 0.75, confidence: "high" },
  top: { timestamp_seconds: 1.0, confidence: "high" },
  downswing: { timestamp_seconds: 1.2, confidence: "high" },
  impact: { window_start_seconds: 1.3, window_end_seconds: 1.4, confidence: "high" },
  follow_through: { timestamp_seconds: 1.8, confidence: "high" },
};
const analysis = (cues: Record<string, string>, overrides: Record<string, unknown> = {}) => ({ summary: "s", camera_angle: "face_on", phases, checkpoint_cues: cues, ...overrides });

const BENT_LEAD_ARM = poseJson(topBody(120, 100)); // lead (left) arm 120 deg -> measured fault at top
const SOUND_TOP = poseJson(topBody(170, 100));
const HIP_SWAY = poseJson(topBody(170, 100), body({ left_hip: kp(165, 200), right_hip: kp(115, 200) })); // hips slid 40 = 0.5 shoulder widths

test("fixtures measure what the tests assume", () => {
  assert.deepEqual(measuredFaultsByPhase(measuredAssessment(analysis({}), BENT_LEAD_ARM)), { top: ["left_arm"] });
  assert.deepEqual(measuredFaultsByPhase(measuredAssessment(analysis({}), SOUND_TOP)), {});
  assert.deepEqual(measuredFaultsByPhase(measuredAssessment(analysis({}), HIP_SWAY)), { impact: ["hip_sway"] });
});

test("the server measures exactly what the client draws", () => {
  const json = analysis({});
  const client = computeSwingAssessment(poseDataFromJson(BENT_LEAD_ARM), phasesFromJson(json.phases), { cameraAngle: "face_on" });
  assert.deepEqual(measuredAssessment(json, BENT_LEAD_ARM), client);
  const pose = poseDataFromJson(BENT_LEAD_ARM)!;
  assert.equal(pose.analysisFps, 8);
  assert.equal(pose.frames[1].timestampSeconds, 1.0);
  assert.equal(pose.frames[1].keypoints.left_shoulder.x, 140);
  assert.deepEqual(phasesFromJson(phases)!.impact, { windowStartSeconds: 1.3, windowEndSeconds: 1.4, confidence: "high" });
});

test("cueBodyParts reads the six app languages", () => {
  const cases: [string, string[]][] = [
    ["Keep your lead arm straight", ["arms"]],
    ["Keep your head still over the ball", ["head"]],
    ["Rotate your hips, don't slide", ["hips"]],
    ["Mantén la cabeza quieta", ["head"]],
    ["Mantén el brazo izquierdo recto", ["arms"]],
    ["Lleva las muñecas arriba", ["hands"]],
    ["頭を動かさないで", ["head"]],
    ["左腕を伸ばしたまま", ["arms"]],
    ["腰を回して", ["hips"]],
    ["머리를 고정하세요", ["head"]],
    ["왼팔을 곧게 펴세요", ["arms"]],
    ["保持头部稳定", ["head"]],
    ["保持頭部穩定", ["head"]],
    ["保持左臂伸直", ["arms"]],
    ["Stay smooth and balanced", []],
    ["체중을 앞으로", []],
  ];
  for (const [cue, parts] of cases) assert.deepEqual([...cueBodyParts(cue)].sort(), parts.sort(), cue);
});

test("cueBodyParts avoids look-alike words", () => {
  assert.deepEqual([...cueBodyParts("팔로우스루까지 끝까지")], []); // follow-through, not 팔 (arm)
  assert.deepEqual([...cueBodyParts("回転不足に注意")], []); // 不足 = not enough, not 足
  assert.deepEqual([...cueBodyParts("Grab the handle lightly")], []); // handle, not hand
  assert.deepEqual([...cueBodyParts("Shipshape tempo")], []); // hip inside a word
});

test("cueContradictsFaults: drops only a cue clearly about another body part", () => {
  assert.equal(cueContradictsFaults("Keep your head still", ["left_arm"]), true);
  assert.equal(cueContradictsFaults("Keep your lead arm straight", ["left_arm"]), false);
  assert.equal(cueContradictsFaults("Push your hands away from you", ["left_arm"]), false); // hands can fix arm width
  assert.equal(cueContradictsFaults("Keep your head still and arm straight", ["left_arm"]), false); // names the fault too
  assert.equal(cueContradictsFaults("Stay smooth", ["left_arm"]), false); // no body part: can't tell
  assert.equal(cueContradictsFaults("Keep your head still", []), false); // nothing measured to contradict
  assert.equal(cueContradictsFaults("Post up on your lead leg", ["hip_sway"]), false);
  assert.equal(cueContradictsFaults("Turn your shoulders more", ["hip_sway"]), true);
  assert.equal(cueContradictsFaults("Keep your head still", ["left_arm", "torso"]), true);
  assert.equal(cueContradictsFaults("Keep your chest over the ball", ["left_arm", "torso"]), false);
});

test("withMeasuredCueCheck drops the contradicting cue and keeps the rest verbatim", () => {
  const cues = { address: "Keep your head level", top: "Keep your head still", impact: "Rotate your hips", follow_through: "Hold your head up" };
  const { json, dropped } = withMeasuredCueCheck(analysis(cues), BENT_LEAD_ARM);
  assert.deepEqual(dropped, ["top"]);
  // address has no measured fault; follow_through is never measured.
  assert.deepEqual(json.checkpoint_cues, { address: "Keep your head level", impact: "Rotate your hips", follow_through: "Hold your head up" });
  assert.equal(json.summary, "s");
});

test("withMeasuredCueCheck keeps cues that agree with the measured fault, in any language", () => {
  for (const cue of ["Keep your lead arm straight", "左腕を伸ばしたまま", "왼팔을 곧게 펴세요", "保持左臂伸直", "Mantén el brazo izquierdo recto", "Stay smooth"]) {
    const { dropped } = withMeasuredCueCheck(analysis({ top: cue }), BENT_LEAD_ARM);
    assert.deepEqual(dropped, [], cue);
  }
  for (const cue of ["頭を動かさないで", "머리를 고정하세요", "保持头部稳定", "保持頭部穩定", "Mantén la cabeza quieta"]) {
    const { dropped } = withMeasuredCueCheck(analysis({ top: cue }), BENT_LEAD_ARM);
    assert.deepEqual(dropped, ["top"], cue);
  }
});

test("withMeasuredCueCheck checks impact against hip sway", () => {
  assert.deepEqual(withMeasuredCueCheck(analysis({ impact: "Keep your head behind the ball" }), HIP_SWAY).dropped, ["impact"]);
  assert.deepEqual(withMeasuredCueCheck(analysis({ impact: "腰を回して" }), HIP_SWAY).dropped, []);
});

test("withMeasuredCueCheck removes the field when no cue survives", () => {
  const { json, dropped } = withMeasuredCueCheck(analysis({ top: "Keep your head still" }), BENT_LEAD_ARM);
  assert.deepEqual(dropped, ["top"]);
  assert.equal("checkpoint_cues" in json, false);
});

test("withMeasuredCueCheck leaves the analysis alone when nothing is measured reliably", () => {
  const cues = { top: "Keep your head still" };
  // A sound swing: no fault to contradict.
  assert.deepEqual(withMeasuredCueCheck(analysis(cues), SOUND_TOP).dropped, []);
  // Low-confidence top: no verdict there at all.
  const lowTop = analysis(cues, { phases: { ...phases, top: { timestamp_seconds: 1.0, confidence: "low" } } });
  assert.deepEqual(withMeasuredCueCheck(lowTop, BENT_LEAD_ARM).dropped, []);
  // No pose data (old rows) or no cues.
  const input = analysis(cues);
  assert.equal(withMeasuredCueCheck(input, null).json, input);
  const noCues = { summary: "s", phases };
  assert.equal(withMeasuredCueCheck(noCues, BENT_LEAD_ARM).json, noCues);
});

test("withMeasuredCueCheck never throws on malformed input", () => {
  const weird: unknown[] = [undefined, null, 42, "x", { frames: "nope" }, { frames: [null, { keypoints: { a: null } }] }];
  for (const pose of weird) {
    const input = analysis({ top: "Keep your head still" }, { phases: "bad" });
    assert.doesNotThrow(() => withMeasuredCueCheck(input, pose));
  }
  assert.doesNotThrow(() => withMeasuredCueCheck({ checkpoint_cues: "nope" }, BENT_LEAD_ARM));
});
