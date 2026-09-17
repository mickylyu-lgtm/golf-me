import type { CaddiePoseData, CaddiePoseFrame, CaddiePoseKeypoint, CaddieSwingPhases } from "../types";

// Colors Caddie's replay skeleton by evaluating a small, deliberately narrow
// set of geometric metrics against fixed thresholds -- NOT by asking Gemini
// to freely decide what's good/bad (see analyze-swing's own system prompt:
// Gemini already reasons over the raw pose time series but only ever
// produces free-text workOn items, never a structured per-segment verdict).
// Pure function of poseData + phases, both already fetched/stored for every
// analysis — no new Roboflow or Gemini calls, no new DB column, no backfill:
// this recomputes identically every time an analysis (old or new) is
// opened, as long as it has poseData. Analyses from before the Roboflow
// pipeline shipped have no poseData at all and simply never reach this —
// same "undefined = pre-pipeline" convention already used for phases/score.
//
// Thresholds below are hand-authored heuristics from common, well-
// established golf-instruction reference ranges (lead-arm extension at the
// top, spine-angle consistency, hip sway through impact, shoulder/hip
// alignment at address, knee flex at address, hand height at the top) --
// NOT validated against a biomechanics dataset or labeled ground truth.
// Treat them as a reasonable starting point pending real coaching review,
// not as clinically precise cutoffs. Deliberately conservative: anything
// between the two thresholds (or missing/low-confidence data) resolves to
// "unknown" rather than forcing a good/bad call — see MIN_KEYPOINT_CONFIDENCE
// and each assess* function's dead zone.
//
// "Wrists" deliberately measures hand HEIGHT at the top (wrist y relative
// to shoulder/hip), not wrist HINGE (cupped/bowed/flat) -- there is no
// hand/fingertip keypoint anywhere in the tracked set (only wrist itself),
// so a true hinge angle isn't honestly measurable from what Roboflow
// actually returns. Height is.

export type SwingSegmentStatus = "good" | "needs_improvement" | "unknown";
export type SwingSegmentId = "torso" | "left_arm" | "right_arm" | "hip_sway" | "shoulder_line" | "knees" | "wrists";
export type SwingAnchorPhase = "address" | "top" | "impact";
// Why a segment is "unknown" — set only when status is "unknown". Lets the
// UI eventually explain itself ("Limited visibility — camera lost the
// wrist here" vs "— not enough contrast to call it either way") instead of
// just showing the same neutral badge for every different real cause.
export type SwingReliabilityReason = "no_keypoint" | "low_confidence" | "phase_not_identified" | "inconclusive";

export interface SwingSegmentAssessment {
  segment: SwingSegmentId;
  anchorPhase: SwingAnchorPhase;
  status: SwingSegmentStatus;
  confidence: number; // 0-1, the minimum contributing keypoint confidence
  // The single keypoint an on-video callout for this segment should pin
  // to — always a real, currently-tracked joint name, never a computed
  // midpoint (nothing to anchor a callout to if that point isn't in
  // frame.keypoints for the current frame — callers must check).
  anchorKeypoint: string;
  reliabilityReason?: SwingReliabilityReason;
}

export interface SwingAssessment {
  segments: SwingSegmentAssessment[]; // always exactly one entry per SwingSegmentId, possibly "unknown"
}

// Below this, a keypoint isn't trusted for a geometric measurement — same
// spirit as Roboflow's own server-side filtering (unreliable joints are
// already dropped before this ever runs), just a second, stricter gate
// specifically for the angle/distance math here, where a slightly-shaky
// low-confidence point can swing a computed angle by tens of degrees.
const MIN_KEYPOINT_CONFIDENCE = 0.5;

// A phase's assessed color only applies while scrubbed within this many
// seconds of that phase's own timestamp -- outside it, the segment reads as
// neutral rather than carrying a stale verdict into a different part of the
// swing (the brief's own lead-elbow example: red at Top, neutral/green by
// Downswing).
const PHASE_DISPLAY_WINDOW_SECONDS = 0.45;

function getKp(frame: CaddiePoseFrame | undefined, name: string): CaddiePoseKeypoint | undefined {
  const k = frame?.keypoints[name];
  return k && k.confidence >= MIN_KEYPOINT_CONFIDENCE ? k : undefined;
}

// Which reliability reason applies when one or more required keypoints
// didn't pass getKp() — "no_keypoint" (Roboflow never reported it at all
// for this frame) takes priority over "low_confidence" (it was reported,
// just not trusted) since a genuinely absent joint is the more informative
// of the two to surface first.
function missingKeypointReason(frame: CaddiePoseFrame, names: string[]): SwingReliabilityReason {
  for (const name of names) {
    if (!frame.keypoints[name]) return "no_keypoint";
  }
  return "low_confidence";
}

function findFrameNear(frames: CaddiePoseFrame[], timestampSeconds: number | null, toleranceSeconds: number): CaddiePoseFrame | undefined {
  if (timestampSeconds === null || frames.length === 0) return undefined;
  let best: CaddiePoseFrame | undefined;
  let bestDelta = Infinity;
  for (const f of frames) {
    const delta = Math.abs(f.timestampSeconds - timestampSeconds);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = f;
    }
  }
  return best && bestDelta <= toleranceSeconds ? best : undefined;
}

// Interior angle at `vertex`, in degrees, between rays vertex->a and
// vertex->b. 180 = perfectly straight; smaller = more bent.
function angleAtVertex(a: CaddiePoseKeypoint, vertex: CaddiePoseKeypoint, b: CaddiePoseKeypoint): number {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Unsigned angle of the line a->b from horizontal, 0-90 degrees.
function lineAngleFromHorizontal(a: CaddiePoseKeypoint, b: CaddiePoseKeypoint): number {
  return (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
}

// Lead/trail can't be determined without knowing the golfer's handedness,
// which nothing in this app captures today (signup, profile, and analysis
// all omit it) -- rather than guess right-handed (the common but not
// universal default) and risk mislabeling a lefty's swing, both arms are
// assessed the same way and shown as plain "left"/"right", never "lead"/
// "trail". A near-straight arm at the top of the backswing is one of the
// most common, broadly-applicable coaching cues regardless of which arm is
// leading.
const ARM_STRAIGHT_DEGREES = 155; // >= this: "good"
const ARM_BENT_DEGREES = 130; // <= this: "needs_improvement"; between the two: "unknown"

function assessArm(topFrame: CaddiePoseFrame | undefined, side: "left" | "right"): SwingSegmentAssessment {
  const segment: SwingSegmentId = side === "left" ? "left_arm" : "right_arm";
  const anchorPhase: SwingAnchorPhase = "top";
  const anchorKeypoint = `${side}_elbow`;
  if (!topFrame) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  const names = [`${side}_shoulder`, `${side}_elbow`, `${side}_wrist`];
  const shoulder = getKp(topFrame, names[0]);
  const elbow = getKp(topFrame, names[1]);
  const wrist = getKp(topFrame, names[2]);
  if (!shoulder || !elbow || !wrist) {
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: missingKeypointReason(topFrame, names) };
  }
  const angle = angleAtVertex(shoulder, elbow, wrist);
  const confidence = Math.min(shoulder.confidence, elbow.confidence, wrist.confidence);
  const status: SwingSegmentStatus = angle >= ARM_STRAIGHT_DEGREES ? "good" : angle <= ARM_BENT_DEGREES ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

function torsoTiltDegrees(frame: CaddiePoseFrame | undefined): number | undefined {
  const ls = getKp(frame, "left_shoulder");
  const rs = getKp(frame, "right_shoulder");
  const lh = getKp(frame, "left_hip");
  const rh = getKp(frame, "right_hip");
  if (!ls || !rs || !lh || !rh) return undefined;
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  // Angle of the hip->shoulder vector from vertical (image y grows downward).
  return (Math.atan2(shoulderMid.x - hipMid.x, hipMid.y - shoulderMid.y) * 180) / Math.PI;
}

// "Maintain your spine angle" is a relative-consistency cue, not a claim
// about one correct absolute angle in isolation -- we don't know the
// camera's exact framing/distance, so comparing Top back to the golfer's
// own Address posture is the defensible version of this check (point 27 in
// the brief: don't imply more precision than the data supports).
const TORSO_DRIFT_GOOD_DEGREES = 10; // <= this drift from address: "good"
const TORSO_DRIFT_ISSUE_DEGREES = 20; // >= this: "needs_improvement"; between: "unknown"

function assessTorso(addressFrame: CaddiePoseFrame | undefined, topFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const segment: SwingSegmentId = "torso";
  const anchorPhase: SwingAnchorPhase = "top";
  const anchorKeypoint = "left_shoulder";
  if (!addressFrame || !topFrame) {
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  }
  const names = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"];
  const addressAngle = torsoTiltDegrees(addressFrame);
  const topAngle = torsoTiltDegrees(topFrame);
  if (addressAngle === undefined || topAngle === undefined) {
    const reason = addressAngle === undefined ? missingKeypointReason(addressFrame, names) : missingKeypointReason(topFrame, names);
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: reason };
  }
  const drift = Math.abs(topAngle - addressAngle);
  const confidence = Math.min(
    ...names.flatMap((name) => [getKp(addressFrame, name)?.confidence ?? 0, getKp(topFrame, name)?.confidence ?? 0]),
  );
  const status: SwingSegmentStatus = drift <= TORSO_DRIFT_GOOD_DEGREES ? "good" : drift >= TORSO_DRIFT_ISSUE_DEGREES ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

// Normalized by shoulder width (a body-relative scale, not an absolute
// pixel distance) so this stays meaningful regardless of how close/zoomed
// the camera is.
const HIP_SWAY_GOOD_RATIO = 0.15;
const HIP_SWAY_ISSUE_RATIO = 0.35;

function assessHipSway(addressFrame: CaddiePoseFrame | undefined, impactFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const segment: SwingSegmentId = "hip_sway";
  const anchorPhase: SwingAnchorPhase = "impact";
  const anchorKeypoint = "left_hip";
  if (!addressFrame || !impactFrame) {
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  }
  const addressNames = ["left_hip", "right_hip", "left_shoulder", "right_shoulder"];
  const impactNames = ["left_hip", "right_hip"];
  const addressLH = getKp(addressFrame, "left_hip");
  const addressRH = getKp(addressFrame, "right_hip");
  const addressLS = getKp(addressFrame, "left_shoulder");
  const addressRS = getKp(addressFrame, "right_shoulder");
  const impactLH = getKp(impactFrame, "left_hip");
  const impactRH = getKp(impactFrame, "right_hip");
  if (!addressLH || !addressRH || !addressLS || !addressRS || !impactLH || !impactRH) {
    const reason = !addressLH || !addressRH || !addressLS || !addressRS
      ? missingKeypointReason(addressFrame, addressNames)
      : missingKeypointReason(impactFrame, impactNames);
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: reason };
  }
  const shoulderWidth = Math.hypot(addressLS.x - addressRS.x, addressLS.y - addressRS.y);
  if (shoulderWidth === 0) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "inconclusive" };
  const addressHipMidX = (addressLH.x + addressRH.x) / 2;
  const impactHipMidX = (impactLH.x + impactRH.x) / 2;
  const ratio = Math.abs(impactHipMidX - addressHipMidX) / shoulderWidth;
  const confidence = Math.min(addressLH.confidence, addressRH.confidence, addressLS.confidence, addressRS.confidence, impactLH.confidence, impactRH.confidence);
  const status: SwingSegmentStatus = ratio <= HIP_SWAY_GOOD_RATIO ? "good" : ratio >= HIP_SWAY_ISSUE_RATIO ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

// Shoulder-line-vs-hip-line parallelism at address — a standard,
// handedness-agnostic setup cue (shoulders and hips roughly aligned to each
// other), rather than guessing at a single "correct" absolute tilt angle
// this app has no validated reference for.
const SHOULDER_HIP_ALIGN_GOOD_DEGREES = 8; // <= this misalignment: "good"
const SHOULDER_HIP_ALIGN_ISSUE_DEGREES = 18; // >= this: "needs_improvement"; between: "unknown"

function assessShoulderLine(addressFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const segment: SwingSegmentId = "shoulder_line";
  const anchorPhase: SwingAnchorPhase = "address";
  const anchorKeypoint = "right_shoulder";
  if (!addressFrame) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  const names = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"];
  const ls = getKp(addressFrame, "left_shoulder");
  const rs = getKp(addressFrame, "right_shoulder");
  const lh = getKp(addressFrame, "left_hip");
  const rh = getKp(addressFrame, "right_hip");
  if (!ls || !rs || !lh || !rh) {
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: missingKeypointReason(addressFrame, names) };
  }
  const shoulderAngle = lineAngleFromHorizontal(ls, rs);
  const hipAngle = lineAngleFromHorizontal(lh, rh);
  const diff = Math.abs(shoulderAngle - hipAngle);
  const confidence = Math.min(ls.confidence, rs.confidence, lh.confidence, rh.confidence);
  const status: SwingSegmentStatus = diff <= SHOULDER_HIP_ALIGN_GOOD_DEGREES ? "good" : diff >= SHOULDER_HIP_ALIGN_ISSUE_DEGREES ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

// Knee flex at address — a single combined segment (not left/right, same
// reasoning as arms not being "lead"/"trail"): driven by whichever knee is
// STRAIGHTER, since one locked knee at address is the flaw worth flagging
// even if the other leg shows healthy flex.
const KNEE_FLEXED_MAX_DEGREES = 170; // <= this (visible bend in the straighter knee): "good"
const KNEE_LOCKED_MIN_DEGREES = 178; // >= this (essentially straight): "needs_improvement"

function kneeAngle(frame: CaddiePoseFrame, side: "left" | "right"): number | undefined {
  const hip = getKp(frame, `${side}_hip`);
  const knee = getKp(frame, `${side}_knee`);
  const ankle = getKp(frame, `${side}_ankle`);
  if (!hip || !knee || !ankle) return undefined;
  return angleAtVertex(hip, knee, ankle);
}

function assessKnees(addressFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const segment: SwingSegmentId = "knees";
  const anchorPhase: SwingAnchorPhase = "address";
  const anchorKeypoint = "left_knee";
  if (!addressFrame) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  const leftAngle = kneeAngle(addressFrame, "left");
  const rightAngle = kneeAngle(addressFrame, "right");
  const angles = [leftAngle, rightAngle].filter((a): a is number => typeof a === "number");
  if (angles.length === 0) {
    const names = ["left_hip", "left_knee", "left_ankle", "right_hip", "right_knee", "right_ankle"];
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: missingKeypointReason(addressFrame, names) };
  }
  const straightest = Math.max(...angles);
  const confidences = [getKp(addressFrame, "left_knee")?.confidence, getKp(addressFrame, "right_knee")?.confidence].filter(
    (c): c is number => typeof c === "number",
  );
  const confidence = Math.min(...confidences);
  const status: SwingSegmentStatus =
    straightest <= KNEE_FLEXED_MAX_DEGREES ? "good" : straightest >= KNEE_LOCKED_MIN_DEGREES ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

// Hand height at the top of the backswing, relative to shoulder height and
// normalized by torso length (body-relative scale, same reasoning as
// hip_sway's shoulder-width normalization) — NOT wrist hinge (cupped/
// bowed/flat), which would need a hand/fingertip keypoint this pipeline
// doesn't track. Image y grows downward, so a positive ratio means the
// wrists sit BELOW shoulder height at the top.
const WRIST_HEIGHT_GOOD_RATIO = 0.05; // <= this (at or above shoulder height): "good"
const WRIST_HEIGHT_LOW_RATIO = 0.35; // >= this (well below shoulder height): "needs_improvement"

function assessWrists(topFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const segment: SwingSegmentId = "wrists";
  const anchorPhase: SwingAnchorPhase = "top";
  const anchorKeypoint = "left_wrist";
  if (!topFrame) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "phase_not_identified" };
  const names = ["left_wrist", "right_wrist", "left_shoulder", "right_shoulder", "left_hip", "right_hip"];
  const lw = getKp(topFrame, "left_wrist");
  const rw = getKp(topFrame, "right_wrist");
  const ls = getKp(topFrame, "left_shoulder");
  const rs = getKp(topFrame, "right_shoulder");
  const lh = getKp(topFrame, "left_hip");
  const rh = getKp(topFrame, "right_hip");
  if (!lw || !rw || !ls || !rs || !lh || !rh) {
    return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: missingKeypointReason(topFrame, names) };
  }
  const shoulderMidY = (ls.y + rs.y) / 2;
  const hipMidY = (lh.y + rh.y) / 2;
  const torsoLength = Math.abs(hipMidY - shoulderMidY);
  if (torsoLength === 0) return { segment, anchorPhase, status: "unknown", confidence: 0, anchorKeypoint, reliabilityReason: "inconclusive" };
  const wristMidY = (lw.y + rw.y) / 2;
  const ratio = (wristMidY - shoulderMidY) / torsoLength;
  const confidence = Math.min(lw.confidence, rw.confidence, ls.confidence, rs.confidence, lh.confidence, rh.confidence);
  const status: SwingSegmentStatus = ratio <= WRIST_HEIGHT_GOOD_RATIO ? "good" : ratio >= WRIST_HEIGHT_LOW_RATIO ? "needs_improvement" : "unknown";
  return { segment, anchorPhase, status, confidence, anchorKeypoint, reliabilityReason: status === "unknown" ? "inconclusive" : undefined };
}

// Computes all segment assessments once for an analysis. Cheap (a handful
// of trig ops on ~3 pose frames) -- safe to call from a useMemo keyed on the
// analysis id, no debouncing/caching infrastructure needed.
export function computeSwingAssessment(poseData: CaddiePoseData | undefined, phases: CaddieSwingPhases | undefined): SwingAssessment | undefined {
  if (!poseData || poseData.frames.length === 0 || !phases) return undefined;
  const tolerance = Math.max(PHASE_DISPLAY_WINDOW_SECONDS, 1 / poseData.analysisFps);
  const addressFrame = findFrameNear(poseData.frames, phases.address.timestampSeconds, tolerance);
  const topFrame = findFrameNear(poseData.frames, phases.top.timestampSeconds, tolerance);
  const impactMid =
    phases.impact.windowStartSeconds !== null && phases.impact.windowEndSeconds !== null
      ? (phases.impact.windowStartSeconds + phases.impact.windowEndSeconds) / 2
      : null;
  const impactFrame = findFrameNear(poseData.frames, impactMid, tolerance);

  return {
    segments: [
      assessTorso(addressFrame, topFrame),
      assessArm(topFrame, "left"),
      assessArm(topFrame, "right"),
      assessHipSway(addressFrame, impactFrame),
      assessShoulderLine(addressFrame),
      assessKnees(addressFrame),
      assessWrists(topFrame),
    ],
  };
}

const ALL_SEGMENT_IDS: SwingSegmentId[] = ["torso", "left_arm", "right_arm", "hip_sway", "shoulder_line", "knees", "wrists"];

// What a segment should render as at video timestamp `t` -- "unknown"
// (neutral) outside its own anchor phase's display window, never a stale
// color carried over from wherever it was actually assessed.
export function segmentStatusAtTime(
  assessment: SwingAssessment | undefined,
  phases: CaddieSwingPhases | undefined,
  t: number,
): Record<SwingSegmentId, SwingSegmentStatus> {
  const base = Object.fromEntries(ALL_SEGMENT_IDS.map((id) => [id, "unknown"])) as Record<SwingSegmentId, SwingSegmentStatus>;
  if (!assessment || !phases) return base;

  const addressT = phases.address.timestampSeconds;
  const topT = phases.top.timestampSeconds;
  const impactT =
    phases.impact.windowStartSeconds !== null && phases.impact.windowEndSeconds !== null
      ? (phases.impact.windowStartSeconds + phases.impact.windowEndSeconds) / 2
      : null;
  const anchorTimeFor = (phase: SwingAnchorPhase): number | null => (phase === "address" ? addressT : phase === "top" ? topT : impactT);

  for (const seg of assessment.segments) {
    const anchorT = anchorTimeFor(seg.anchorPhase);
    if (anchorT === null) continue;
    if (Math.abs(t - anchorT) <= PHASE_DISPLAY_WINDOW_SECONDS) base[seg.segment] = seg.status;
  }
  return base;
}
