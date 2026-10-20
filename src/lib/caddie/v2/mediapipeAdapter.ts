// Converts MediaPipe Pose Landmarker output (33 landmarks per pose, x/y
// normalized to the analyzed frame, plus visibility and an optional presence
// score) into a PoseSequence with our 13 keypoints.
//
// Producer: tools/caddie-eval/pose-local.mjs (local, offline, headless
// Chromium). The same adapter is meant to serve a future in-browser V2 pose
// source, so it stays pure and portable (see the rules in types.ts).
//
// Mapping (BlazePose 33-landmark topology, MediaPipe pose landmarker docs):
//   0 nose, 11/12 left/right shoulder, 13/14 elbows, 15/16 wrists,
//   23/24 hips, 25/26 knees, 27/28 ankles.
// MediaPipe's left/right are the person's anatomical sides for an unmirrored
// image (UNVERIFIED on our clips: confirm on one of Micky's own clips before
// trusting side-specific results).
//
// Rules, all conservative ("missing = not observed", types.ts):
// - output is in source_pixels of the analyzed frame, so x and y have the
//   same scale (normalized coordinates would distort the camera-angle ratios
//   on a portrait frame);
// - a landmark outside the frame (x or y outside 0..1) is dropped: the model
//   extrapolates off-frame joints, and an extrapolated joint is not observed;
// - confidence = visibility, or min(visibility, presence) when the model
//   reports presence. Neither is calibrated across backends;
// - when several poses are found, the largest one (bounding box of its
//   in-frame keypoints) is kept and the frame is counted as multi-person. That
//   is a heuristic: the golfer is usually the nearest person, not always;
// - a frame with no pose is kept with no keypoints, so the quality gate
//   counts it as "no_person" rather than the frame silently vanishing;
// - MediaPipe exposes no per-pose person score in the Tasks API, so
//   personConfidence is null.

import { POSE_SEQUENCE_VERSION } from "./types.ts";
import type { PoseFrame, PoseKeypoint, PoseKeypointName, PoseSequence } from "./types.ts";

export const MEDIAPIPE_ADAPTER_VERSION = "0.1.0";

/** BlazePose landmark index for each of our 13 keypoints. */
export const MEDIAPIPE_LANDMARK_INDEX: Readonly<Record<PoseKeypointName, number>> = Object.freeze({
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
});

export const MEDIAPIPE_LANDMARK_COUNT = 33;

/** One landmark as stored by the extractor: [x, y, z, visibility, presence|null], x/y normalized 0..1. */
export type MediaPipeLandmarkTuple = [number, number, number, number, number | null];

export interface MediaPipeRawFrame {
  frameIndex: number;
  timestampSeconds: number;
  /** One entry per detected pose; each pose has 33 landmarks. */
  poses: MediaPipeLandmarkTuple[][];
}

export interface MediaPipeRawRun {
  /** e.g. "pose_landmarker_full". */
  model: string;
  /** e.g. "1.1.0" (@mediapipe/tasks-vision). */
  runtimeVersion: string;
  /** Pixel size of the frames given to the model (after any downscale). */
  frameWidth: number;
  frameHeight: number;
  analysisFps: number | null;
  framesRequested: number | null;
  frames: MediaPipeRawFrame[];
}

export type MediaPipeAdapterInvalidReason =
  | "not_an_object"
  | "missing_frames_array"
  | "bad_frame_size"
  | "duplicate_frame_index";

export interface MediaPipeAdapterStats {
  /** Frames dropped for a bad index/timestamp/poses field. */
  framesDropped: number;
  framesWithNoPose: number;
  framesWithMultiplePoses: number;
  /** Poses skipped for not having 33 landmarks. */
  posesMalformed: number;
  keypointsOutOfFrame: number;
  keypointsNonFinite: number;
}

export type MediaPipeAdapterResult =
  | { status: "ok"; adapterVersion: string; sequence: PoseSequence; stats: MediaPipeAdapterStats }
  | { status: "invalid"; adapterVersion: string; invalidReason: MediaPipeAdapterInvalidReason; stats: MediaPipeAdapterStats };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Our keypoints from one pose, in pixels. Null when the pose is malformed. */
function convertPose(
  pose: unknown,
  width: number,
  height: number,
  stats: MediaPipeAdapterStats,
): { keypoints: PoseFrame["keypoints"]; area: number } | null {
  if (!Array.isArray(pose) || pose.length !== MEDIAPIPE_LANDMARK_COUNT) return null;
  const keypoints: PoseFrame["keypoints"] = {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [name, index] of Object.entries(MEDIAPIPE_LANDMARK_INDEX) as [PoseKeypointName, number][]) {
    const lm = pose[index];
    if (!Array.isArray(lm)) {
      stats.keypointsNonFinite++;
      continue;
    }
    const [x, y, , visibility, presence] = lm as unknown[];
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(visibility)) {
      stats.keypointsNonFinite++;
      continue;
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      stats.keypointsOutOfFrame++;
      continue;
    }
    let confidence = clamp01(visibility);
    if (isFiniteNumber(presence)) confidence = Math.min(confidence, clamp01(presence));
    const kp: PoseKeypoint = { x: x * width, y: y * height, confidence };
    keypoints[name] = kp;
    minX = Math.min(minX, kp.x);
    maxX = Math.max(maxX, kp.x);
    minY = Math.min(minY, kp.y);
    maxY = Math.max(maxY, kp.y);
  }
  const area = Number.isFinite(minX) ? (maxX - minX) * (maxY - minY) : 0;
  return { keypoints, area };
}

export function adaptMediaPipeRun(raw: unknown, options: { backendVersion?: string } = {}): MediaPipeAdapterResult {
  const stats: MediaPipeAdapterStats = {
    framesDropped: 0,
    framesWithNoPose: 0,
    framesWithMultiplePoses: 0,
    posesMalformed: 0,
    keypointsOutOfFrame: 0,
    keypointsNonFinite: 0,
  };
  const base = { adapterVersion: MEDIAPIPE_ADAPTER_VERSION };
  const invalid = (invalidReason: MediaPipeAdapterInvalidReason): MediaPipeAdapterResult => ({
    ...base,
    status: "invalid",
    invalidReason,
    stats,
  });

  if (!isRecord(raw)) return invalid("not_an_object");
  if (!Array.isArray(raw.frames)) return invalid("missing_frames_array");
  const { frameWidth, frameHeight } = raw;
  if (!isFiniteNumber(frameWidth) || !isFiniteNumber(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
    return invalid("bad_frame_size");
  }

  const frames: PoseFrame[] = [];
  const seen = new Set<number>();
  for (const rawFrame of raw.frames) {
    if (
      !isRecord(rawFrame) ||
      !Number.isInteger(rawFrame.frameIndex) ||
      (rawFrame.frameIndex as number) < 0 ||
      !isFiniteNumber(rawFrame.timestampSeconds) ||
      rawFrame.timestampSeconds < 0 ||
      !Array.isArray(rawFrame.poses)
    ) {
      stats.framesDropped++;
      continue;
    }
    const frameIndex = rawFrame.frameIndex as number;
    if (seen.has(frameIndex)) return invalid("duplicate_frame_index");
    seen.add(frameIndex);

    let best: { keypoints: PoseFrame["keypoints"]; area: number } | null = null;
    let validPoses = 0;
    for (const pose of rawFrame.poses) {
      const converted = convertPose(pose, frameWidth, frameHeight, stats);
      if (!converted) {
        stats.posesMalformed++;
        continue;
      }
      validPoses++;
      if (!best || converted.area > best.area) best = converted;
    }
    if (validPoses === 0) stats.framesWithNoPose++;
    if (validPoses > 1) stats.framesWithMultiplePoses++;
    frames.push({
      frameIndex,
      timestampSeconds: rawFrame.timestampSeconds,
      personConfidence: null,
      keypoints: best ? best.keypoints : {},
    });
  }
  frames.sort((a, b) => a.timestampSeconds - b.timestampSeconds || a.frameIndex - b.frameIndex);

  const model = typeof raw.model === "string" && raw.model ? raw.model : "unknown_model";
  const runtime = typeof raw.runtimeVersion === "string" && raw.runtimeVersion ? raw.runtimeVersion : "unknown";
  // Dropped frames still count as requested, so the quality gate treats them as unusable.
  const declared = isFiniteNumber(raw.framesRequested) && raw.framesRequested >= 0 ? Math.floor(raw.framesRequested) : 0;
  const framesRequested = Math.max(declared, raw.frames.length);
  const sequence: PoseSequence = {
    version: POSE_SEQUENCE_VERSION,
    backend: "mediapipe_pose_landmarker",
    backendVersion: options.backendVersion ?? `${model}@tasks-vision-${runtime}`,
    coordinateSpace: "source_pixels",
    sourceWidth: frameWidth,
    sourceHeight: frameHeight,
    analysisFps: isFiniteNumber(raw.analysisFps) && raw.analysisFps > 0 ? raw.analysisFps : null,
    framesRequested,
    frames,
  };
  return { ...base, status: "ok", sequence, stats };
}
