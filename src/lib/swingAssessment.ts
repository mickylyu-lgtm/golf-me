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
// top, spine-angle consistency, hip sway through impact) -- NOT validated
// against a biomechanics dataset or labeled ground truth. Treat them as a
// reasonable starting point pending real coaching review, not as clinically
// precise cutoffs. Deliberately conservative: anything between the two
// thresholds (or missing/low-confidence data) resolves to "unknown" rather
// than forcing a good/bad call — see MIN_KEYPOINT_CONFIDENCE and each
// assess* function's dead zone.

export type SwingSegmentStatus = "good" | "needs_improvement" | "unknown";
export type SwingSegmentId = "torso" | "left_arm" | "right_arm" | "hip_sway";
export type SwingAnchorPhase = "top" | "impact";

export interface SwingSegmentAssessment {
  segment: SwingSegmentId;
  anchorPhase: SwingAnchorPhase;
  status: SwingSegmentStatus;
  confidence: number; // 0-1, the minimum contributing keypoint confidence
}

export interface SwingAssessment {
  segments: SwingSegmentAssessment[]; // always exactly 4 entries, one per SwingSegmentId, possibly "unknown"
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
  const shoulder = getKp(topFrame, `${side}_shoulder`);
  const elbow = getKp(topFrame, `${side}_elbow`);
  const wrist = getKp(topFrame, `${side}_wrist`);
  if (!shoulder || !elbow || !wrist) return { segment, anchorPhase: "top", status: "unknown", confidence: 0 };

  const angle = angleAtVertex(shoulder, elbow, wrist);
  const confidence = Math.min(shoulder.confidence, elbow.confidence, wrist.confidence);
  const status: SwingSegmentStatus = angle >= ARM_STRAIGHT_DEGREES ? "good" : angle <= ARM_BENT_DEGREES ? "needs_improvement" : "unknown";
  return { segment, anchorPhase: "top", status, confidence };
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
  const addressAngle = torsoTiltDegrees(addressFrame);
  const topAngle = torsoTiltDegrees(topFrame);
  if (addressAngle === undefined || topAngle === undefined) {
    return { segment: "torso", anchorPhase: "top", status: "unknown", confidence: 0 };
  }
  const drift = Math.abs(topAngle - addressAngle);
  const confidence = Math.min(
    ...["left_shoulder", "right_shoulder", "left_hip", "right_hip"].flatMap((name) => [
      getKp(addressFrame, name)?.confidence ?? 0,
      getKp(topFrame, name)?.confidence ?? 0,
    ]),
  );
  const status: SwingSegmentStatus = drift <= TORSO_DRIFT_GOOD_DEGREES ? "good" : drift >= TORSO_DRIFT_ISSUE_DEGREES ? "needs_improvement" : "unknown";
  return { segment: "torso", anchorPhase: "top", status, confidence };
}

// Normalized by shoulder width (a body-relative scale, not an absolute
// pixel distance) so this stays meaningful regardless of how close/zoomed
// the camera is.
const HIP_SWAY_GOOD_RATIO = 0.15;
const HIP_SWAY_ISSUE_RATIO = 0.35;

function assessHipSway(addressFrame: CaddiePoseFrame | undefined, impactFrame: CaddiePoseFrame | undefined): SwingSegmentAssessment {
  const addressLH = getKp(addressFrame, "left_hip");
  const addressRH = getKp(addressFrame, "right_hip");
  const addressLS = getKp(addressFrame, "left_shoulder");
  const addressRS = getKp(addressFrame, "right_shoulder");
  const impactLH = getKp(impactFrame, "left_hip");
  const impactRH = getKp(impactFrame, "right_hip");
  if (!addressLH || !addressRH || !addressLS || !addressRS || !impactLH || !impactRH) {
    return { segment: "hip_sway", anchorPhase: "impact", status: "unknown", confidence: 0 };
  }
  const shoulderWidth = Math.hypot(addressLS.x - addressRS.x, addressLS.y - addressRS.y);
  if (shoulderWidth === 0) return { segment: "hip_sway", anchorPhase: "impact", status: "unknown", confidence: 0 };
  const addressHipMidX = (addressLH.x + addressRH.x) / 2;
  const impactHipMidX = (impactLH.x + impactRH.x) / 2;
  const ratio = Math.abs(impactHipMidX - addressHipMidX) / shoulderWidth;
  const confidence = Math.min(addressLH.confidence, addressRH.confidence, addressLS.confidence, addressRS.confidence, impactLH.confidence, impactRH.confidence);
  const status: SwingSegmentStatus = ratio <= HIP_SWAY_GOOD_RATIO ? "good" : ratio >= HIP_SWAY_ISSUE_RATIO ? "needs_improvement" : "unknown";
  return { segment: "hip_sway", anchorPhase: "impact", status, confidence };
}

// Computes all 4 segment assessments once for an analysis. Cheap (a handful
// of trig ops on ~2 pose frames) -- safe to call from a useMemo keyed on the
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
    segments: [assessTorso(addressFrame, topFrame), assessArm(topFrame, "left"), assessArm(topFrame, "right"), assessHipSway(addressFrame, impactFrame)],
  };
}

// What a segment should render as at video timestamp `t` -- "unknown"
// (neutral) outside its own anchor phase's display window, never a stale
// color carried over from wherever it was actually assessed.
export function segmentStatusAtTime(assessment: SwingAssessment | undefined, phases: CaddieSwingPhases | undefined, t: number): Record<SwingSegmentId, SwingSegmentStatus> {
  const base: Record<SwingSegmentId, SwingSegmentStatus> = { torso: "unknown", left_arm: "unknown", right_arm: "unknown", hip_sway: "unknown" };
  if (!assessment || !phases) return base;

  const topT = phases.top.timestampSeconds;
  const impactT =
    phases.impact.windowStartSeconds !== null && phases.impact.windowEndSeconds !== null
      ? (phases.impact.windowStartSeconds + phases.impact.windowEndSeconds) / 2
      : null;

  for (const seg of assessment.segments) {
    const anchorT = seg.anchorPhase === "top" ? topT : impactT;
    if (anchorT === null) continue;
    if (Math.abs(t - anchorT) <= PHASE_DISPLAY_WINDOW_SECONDS) base[seg.segment] = seg.status;
  }
  return base;
}
