// Frame and sequence quality gate (audit §7.2 step 3, gap C7).
//
// V1 counts any HTTP-200 Roboflow frame as a "success", even one with zero
// body keypoints. This gate instead asks, per frame: is a golfer actually
// here, with enough confidently-tracked joints to measure anything? And per
// sequence: are there enough such frames to analyze at all?
//
// It does not (yet) check "exactly one person", "full body in frame" against
// frame edges (V1 never stored frame size), or "a swing actually happened";
// those belong to later modules.

import { thresholdValue } from "./thresholds.ts";
import { POSE_KEYPOINT_NAMES } from "./types.ts";
import type { PoseFrame, PoseKeypointName, PoseSequence } from "./types.ts";

export const QUALITY_GATE_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// PROVISIONAL THRESHOLDS: placeholders, NOT validated.
// Values and their status live in thresholds.ts (the single registry). None
// has been checked against real swings. They must be tuned on the consented,
// coach-labeled evaluation set (audit §8) before any result from this gate is
// shown to a user or quoted as accuracy.
// ---------------------------------------------------------------------------

/** A keypoint below this confidence is treated as not observed. Matches V1 swingAssessment's MIN_KEYPOINT_CONFIDENCE. PROVISIONAL. */
export const QG_MIN_KEYPOINT_CONFIDENCE = thresholdValue("QG_MIN_KEYPOINT_CONFIDENCE");
/** If the backend reports a person score, frames below it are rejected. PROVISIONAL. */
export const QG_MIN_PERSON_CONFIDENCE = thresholdValue("QG_MIN_PERSON_CONFIDENCE");
/** Minimum confident keypoints (of 13) for a frame to be usable. PROVISIONAL. */
export const QG_MIN_CONFIDENT_KEYPOINTS = thresholdValue("QG_MIN_CONFIDENT_KEYPOINTS");
/** Minimum confident torso points (of both shoulders + both hips). Torso anchors every measurement. PROVISIONAL. */
export const QG_MIN_CONFIDENT_TORSO_KEYPOINTS = thresholdValue("QG_MIN_CONFIDENT_TORSO_KEYPOINTS");
/** Minimum usable frames for the whole sequence. PROVISIONAL. */
export const QG_MIN_USABLE_FRAMES = thresholdValue("QG_MIN_USABLE_FRAMES");
/** Minimum share of frames that must be usable. Mirrors V1's 50 % rule, but on usable frames rather than HTTP successes. PROVISIONAL. */
export const QG_MIN_USABLE_FRAME_RATIO = thresholdValue("QG_MIN_USABLE_FRAME_RATIO");

const TORSO_KEYPOINTS: readonly PoseKeypointName[] = ["left_shoulder", "right_shoulder", "left_hip", "right_hip"];

export type FrameRejectReason = "no_person" | "low_person_confidence" | "too_few_keypoints" | "torso_not_visible";

export type FrameQualityVerdict =
  | { usable: true; confidentKeypoints: number }
  | { usable: false; confidentKeypoints: number; reason: FrameRejectReason };

export function countConfidentKeypoints(
  frame: PoseFrame,
  names: readonly PoseKeypointName[] = POSE_KEYPOINT_NAMES,
  minConfidence: number = QG_MIN_KEYPOINT_CONFIDENCE,
): number {
  let n = 0;
  for (const name of names) {
    const kp = frame.keypoints[name];
    if (kp && kp.confidence >= minConfidence) n++;
  }
  return n;
}

export function assessFrameQuality(frame: PoseFrame): FrameQualityVerdict {
  const confidentKeypoints = countConfidentKeypoints(frame);
  const anyKeypoint = Object.keys(frame.keypoints).length > 0;

  if (!anyKeypoint) return { usable: false, confidentKeypoints, reason: "no_person" };
  // A null person score is not a rejection: some backends never report one.
  if (frame.personConfidence !== null && frame.personConfidence < QG_MIN_PERSON_CONFIDENCE) {
    return { usable: false, confidentKeypoints, reason: "low_person_confidence" };
  }
  if (confidentKeypoints < QG_MIN_CONFIDENT_KEYPOINTS) {
    return { usable: false, confidentKeypoints, reason: "too_few_keypoints" };
  }
  if (countConfidentKeypoints(frame, TORSO_KEYPOINTS) < QG_MIN_CONFIDENT_TORSO_KEYPOINTS) {
    return { usable: false, confidentKeypoints, reason: "torso_not_visible" };
  }
  return { usable: true, confidentKeypoints };
}

export type QualityGateInconclusiveReason = "empty_sequence" | "too_few_usable_frames" | "usable_ratio_too_low";

export interface QualityGateResult {
  moduleVersion: string;
  status: "pass" | "inconclusive";
  inconclusiveReason: QualityGateInconclusiveReason | null;
  /** max(frames.length, framesRequested): frames the backend was asked for. */
  totalFrames: number;
  /** Requested frames absent from the sequence (e.g. V1 Roboflow call failures). */
  missingFrames: number;
  usableFrameIndices: number[];
  /** usable / total. Doubles as the gate's (uncalibrated) confidence. */
  usableRatio: number;
  confidence: number;
  rejectCounts: Record<FrameRejectReason, number>;
}

export function runQualityGate(sequence: PoseSequence): QualityGateResult {
  const rejectCounts: Record<FrameRejectReason, number> = {
    no_person: 0,
    low_person_confidence: 0,
    too_few_keypoints: 0,
    torso_not_visible: 0,
  };
  const usableFrameIndices: number[] = [];
  for (const frame of sequence.frames) {
    const verdict = assessFrameQuality(frame);
    if (verdict.usable) usableFrameIndices.push(frame.frameIndex);
    else rejectCounts[verdict.reason]++;
  }

  // Frames the producer dropped before storing count as unusable.
  const totalFrames = Math.max(sequence.frames.length, sequence.framesRequested ?? 0);
  const missingFrames = totalFrames - sequence.frames.length;
  const usableRatio = totalFrames === 0 ? 0 : usableFrameIndices.length / totalFrames;

  let inconclusiveReason: QualityGateInconclusiveReason | null = null;
  if (sequence.frames.length === 0) inconclusiveReason = "empty_sequence";
  else if (usableFrameIndices.length < QG_MIN_USABLE_FRAMES) inconclusiveReason = "too_few_usable_frames";
  else if (usableRatio < QG_MIN_USABLE_FRAME_RATIO) inconclusiveReason = "usable_ratio_too_low";

  return {
    moduleVersion: QUALITY_GATE_VERSION,
    status: inconclusiveReason === null ? "pass" : "inconclusive",
    inconclusiveReason,
    totalFrames,
    missingFrames,
    usableFrameIndices,
    usableRatio,
    confidence: usableRatio,
    rejectCounts,
  };
}
