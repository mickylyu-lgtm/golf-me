// Synthetic pose fixtures for Caddie V2 unit tests. Hand-made stick figures
// in pixel space; no real user data, no recorded swings. Only imported by
// *.test.ts files, so it never reaches the Vite bundle.

import { POSE_KEYPOINT_NAMES, POSE_SEQUENCE_VERSION } from "./types.ts";
import type { PoseFrame, PoseKeypointName, PoseSequence } from "./types.ts";

type Points = Record<PoseKeypointName, [number, number]>;

/** Golfer at address filmed face-on: chest toward camera, joints spread left-right. */
export const FACE_ON_ADDRESS: Points = {
  nose: [140, 60],
  left_shoulder: [180, 100],
  right_shoulder: [100, 100],
  left_elbow: [170, 150],
  right_elbow: [110, 150],
  left_wrist: [150, 190],
  right_wrist: [130, 190],
  left_hip: [165, 220],
  right_hip: [115, 220],
  left_knee: [170, 290],
  right_knee: [110, 290],
  left_ankle: [175, 360],
  right_ankle: [105, 360],
};

/** Golfer at address filmed down-the-line: bent forward, left/right joints nearly overlapping. */
export const DTL_ADDRESS: Points = {
  nose: [170, 75],
  left_shoulder: [150, 100],
  right_shoulder: [140, 105],
  left_elbow: [160, 150],
  right_elbow: [152, 152],
  left_wrist: [170, 195],
  right_wrist: [166, 196],
  left_hip: [128, 200],
  right_hip: [120, 202],
  left_knee: [140, 280],
  right_knee: [134, 282],
  left_ankle: [132, 360],
  right_ankle: [126, 361],
};

/** Roughly 45 degrees: spans fall between the face-on and down-the-line thresholds. */
export const OBLIQUE_ADDRESS: Points = {
  ...FACE_ON_ADDRESS,
  left_shoulder: [165, 100],
  right_shoulder: [115, 100],
  left_hip: [155, 220],
  right_hip: [125, 220],
};

export function makeFrame(
  frameIndex: number,
  timestampSeconds: number,
  points: Partial<Points>,
  options: { confidence?: number; personConfidence?: number | null } = {},
): PoseFrame {
  const confidence = options.confidence ?? 0.9;
  const keypoints: PoseFrame["keypoints"] = {};
  for (const name of POSE_KEYPOINT_NAMES) {
    const p = points[name];
    if (p) keypoints[name] = { x: p[0], y: p[1], confidence };
  }
  return {
    frameIndex,
    timestampSeconds,
    personConfidence: options.personConfidence === undefined ? 0.95 : options.personConfidence,
    keypoints,
  };
}

/** n evenly spaced frames at 8 fps, all built from the same points. */
export function makeFrames(n: number, points: Partial<Points>, options: Parameters<typeof makeFrame>[3] = {}): PoseFrame[] {
  return Array.from({ length: n }, (_, i) => makeFrame(i, i / 8, points, options));
}

export function makeSequence(frames: PoseFrame[], overrides: Partial<PoseSequence> = {}): PoseSequence {
  return {
    version: POSE_SEQUENCE_VERSION,
    backend: "synthetic",
    backendVersion: "test",
    coordinateSpace: "source_pixels",
    sourceWidth: null,
    sourceHeight: null,
    analysisFps: 8,
    framesRequested: null,
    frames,
    ...overrides,
  };
}

/** Keep only the named keypoints of a point set. */
export function only(points: Points, names: PoseKeypointName[]): Partial<Points> {
  const out: Partial<Points> = {};
  for (const n of names) out[n] = points[n];
  return out;
}
