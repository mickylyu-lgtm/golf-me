// First camera-angle heuristic (audit §7.2 step 4).
//
// Idea: at address the golfer faces the ball. Filmed face-on, the camera
// sees the chest, so both shoulders and both hips are far apart horizontally
// relative to torso length. Filmed down-the-line, the camera looks along the
// target line, so left and right joints nearly overlap. Ratios to torso
// length keep this independent of resolution and distance.
//
// Only frames near address are used: during the swing, rotation makes a
// face-on golfer look narrow at the top and a down-the-line golfer look wide
// at the finish, so mid-swing frames would vote the wrong way.
//
// Any doubt resolves to "unknown". 45-degree and other angles are expected
// to land in the dead zone between thresholds. V2 still plans a user
// confirmation step; this heuristic must never be the only signal shown.

import { QG_MIN_KEYPOINT_CONFIDENCE, assessFrameQuality } from "./qualityGate.ts";
import type { PoseFrame, PoseKeypoint, PoseSequence } from "./types.ts";

export const CAMERA_ANGLE_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// PROVISIONAL THRESHOLDS: placeholders, NOT validated.
// Chosen from rough 2-D geometry, not from labeled clips. Must be tuned on
// the coach-labeled evaluation set (audit §8), per pose backend, before any
// result is shown to a user. No accuracy is claimed for these values.
// ---------------------------------------------------------------------------

/** Horizontal shoulder span / torso length at or above this votes face-on. PROVISIONAL. */
export const CA_FACE_ON_MIN_SHOULDER_RATIO = 0.55;
/** Horizontal hip span / torso length at or above this is required for a face-on vote. PROVISIONAL. */
export const CA_FACE_ON_MIN_HIP_RATIO = 0.35;
/** Horizontal shoulder span / torso length at or below this votes down-the-line. PROVISIONAL. */
export const CA_DTL_MAX_SHOULDER_RATIO = 0.3;
/** Horizontal hip span / torso length at or below this is required for a down-the-line vote. PROVISIONAL. */
export const CA_DTL_MAX_HIP_RATIO = 0.2;
/** Torso (shoulder-mid to hip-mid) more than this far from vertical: frame skipped (lying down, rotated video). PROVISIONAL. */
export const CA_MAX_TORSO_TILT_DEGREES = 60;
/** Without an address hint, use this many earliest usable frames. PROVISIONAL. */
export const CA_DEFAULT_ADDRESS_FRAMES = 5;
/** With an address hint, use usable frames within this many seconds of it. PROVISIONAL. */
export const CA_ADDRESS_WINDOW_SECONDS = 0.25;
/** Minimum frames that must yield a measurement. PROVISIONAL. */
export const CA_MIN_MEASURED_FRAMES = 3;
/** Minimum share of measured frames that must agree on the winning angle. PROVISIONAL. */
export const CA_MIN_AGREEMENT = 0.67;

export type CameraAngle = "face_on" | "down_the_line" | "unknown";

export type CameraAngleInconclusiveReason = "insufficient_frames" | "ambiguous_geometry" | "frames_disagree";

export interface CameraAngleResult {
  moduleVersion: string;
  angle: CameraAngle;
  /** Share of measured frames agreeing with `angle`. A heuristic, NOT a calibrated probability. 0 when unknown. */
  confidence: number;
  inconclusiveReason: CameraAngleInconclusiveReason | null;
  framesConsidered: number;
  framesMeasured: number;
  votes: { face_on: number; down_the_line: number; ambiguous: number };
  /** For calibration/debugging; null when nothing was measured. */
  medianShoulderRatio: number | null;
  medianHipRatio: number | null;
}

interface FrameGeometry {
  shoulderRatio: number;
  hipRatio: number;
}

function confident(frame: PoseFrame, name: keyof PoseFrame["keypoints"]): PoseKeypoint | null {
  const kp = frame.keypoints[name];
  return kp && kp.confidence >= QG_MIN_KEYPOINT_CONFIDENCE ? kp : null;
}

/** Scale-free torso geometry for one frame, or null if it can't be measured honestly. */
export function measureFrameGeometry(frame: PoseFrame): FrameGeometry | null {
  const ls = confident(frame, "left_shoulder");
  const rs = confident(frame, "right_shoulder");
  const lh = confident(frame, "left_hip");
  const rh = confident(frame, "right_hip");
  if (!ls || !rs || !lh || !rh) return null;

  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const dx = hipMid.x - shoulderMid.x;
  const dy = hipMid.y - shoulderMid.y; // image y grows downward: hips should be below shoulders
  const torsoLength = Math.hypot(dx, dy);
  if (!(torsoLength > 0) || dy <= 0) return null;
  const tiltDegrees = (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
  if (tiltDegrees > CA_MAX_TORSO_TILT_DEGREES) return null;

  return {
    shoulderRatio: Math.abs(ls.x - rs.x) / torsoLength,
    hipRatio: Math.abs(lh.x - rh.x) / torsoLength,
  };
}

function classify(g: FrameGeometry): "face_on" | "down_the_line" | "ambiguous" {
  if (g.shoulderRatio >= CA_FACE_ON_MIN_SHOULDER_RATIO && g.hipRatio >= CA_FACE_ON_MIN_HIP_RATIO) return "face_on";
  if (g.shoulderRatio <= CA_DTL_MAX_SHOULDER_RATIO && g.hipRatio <= CA_DTL_MAX_HIP_RATIO) return "down_the_line";
  return "ambiguous";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pickAddressFrames(sequence: PoseSequence, addressTimeSeconds: number | null): PoseFrame[] {
  const usable = sequence.frames.filter((f) => assessFrameQuality(f).usable);
  if (addressTimeSeconds !== null && Number.isFinite(addressTimeSeconds)) {
    return usable.filter((f) => Math.abs(f.timestampSeconds - addressTimeSeconds) <= CA_ADDRESS_WINDOW_SECONDS);
  }
  return usable.slice(0, CA_DEFAULT_ADDRESS_FRAMES);
}

/**
 * @param options.addressTimeSeconds Optional address time (e.g. from a
 *   trusted phase). Without it the earliest usable frames are assumed to be
 *   at or near address, which holds only if the clip starts before takeaway.
 */
export function classifyCameraAngle(
  sequence: PoseSequence,
  options: { addressTimeSeconds?: number | null } = {},
): CameraAngleResult {
  const considered = pickAddressFrames(sequence, options.addressTimeSeconds ?? null);
  const geometries = considered.map(measureFrameGeometry).filter((g): g is FrameGeometry => g !== null);

  const votes = { face_on: 0, down_the_line: 0, ambiguous: 0 };
  for (const g of geometries) votes[classify(g)]++;

  const base = {
    moduleVersion: CAMERA_ANGLE_VERSION,
    framesConsidered: considered.length,
    framesMeasured: geometries.length,
    votes,
    medianShoulderRatio: median(geometries.map((g) => g.shoulderRatio)),
    medianHipRatio: median(geometries.map((g) => g.hipRatio)),
  };
  const unknown = (reason: CameraAngleInconclusiveReason): CameraAngleResult => ({
    ...base,
    angle: "unknown",
    confidence: 0,
    inconclusiveReason: reason,
  });

  if (geometries.length < CA_MIN_MEASURED_FRAMES) return unknown("insufficient_frames");

  const winner: "face_on" | "down_the_line" = votes.face_on >= votes.down_the_line ? "face_on" : "down_the_line";
  const agreement = votes[winner] / geometries.length;
  if (agreement < CA_MIN_AGREEMENT || votes.face_on === votes.down_the_line) {
    return unknown(votes.face_on > 0 && votes.down_the_line > 0 ? "frames_disagree" : "ambiguous_geometry");
  }
  return { ...base, angle: winner, confidence: agreement, inconclusiveReason: null };
}
