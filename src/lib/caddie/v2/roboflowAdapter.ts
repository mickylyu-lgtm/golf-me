// Converts the pose data V1 persists in caddie_analyses.roboflow_analysis_json
// (written by supabase/functions/analyze-swing, `trustedPoseData`) into a
// PoseSequence, so historical V1 rows can be replayed through V2 modules
// without any new Roboflow calls.
//
// Stored V1 shape (snake_case, already filtered server-side to keypoints
// Roboflow marked metric_reliable):
//   { video: { analysis_fps, ... },
//     frames: [{ frame_index, timestamp_seconds, person_confidence,
//                keypoints: { <name>: { x, y, confidence } }, body_metrics }],
//     limitations: string[] }
//
// The input is treated as untrusted JSON: anything malformed is dropped and
// counted rather than repaired or guessed. body_metrics are ignored on
// purpose; V2 recomputes measurements from keypoints.

import { POSE_SEQUENCE_VERSION, isPoseKeypointName } from "./types.ts";
import type { PoseFrame, PoseKeypoint, PoseSequence } from "./types.ts";

export const ROBOFLOW_ADAPTER_VERSION = "0.1.0";

export type RoboflowAdapterInconclusiveReason = "not_an_object" | "missing_frames_array" | "no_valid_frames";

export interface RoboflowAdapterDropCounts {
  /** Frames rejected for a missing/invalid index or timestamp. */
  frames: number;
  /** Keypoints rejected for an unknown name or non-finite / out-of-range values. */
  keypoints: number;
}

export type RoboflowAdapterResult =
  | { status: "ok"; adapterVersion: string; sequence: PoseSequence; dropped: RoboflowAdapterDropCounts }
  | {
      status: "inconclusive";
      adapterVersion: string;
      inconclusiveReason: RoboflowAdapterInconclusiveReason;
      dropped: RoboflowAdapterDropCounts;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseKeypoint(raw: unknown): PoseKeypoint | null {
  if (!isRecord(raw)) return null;
  const { x, y, confidence } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;
  return { x, y, confidence };
}

export function adaptV1RoboflowPoseData(raw: unknown): RoboflowAdapterResult {
  const dropped: RoboflowAdapterDropCounts = { frames: 0, keypoints: 0 };
  const base = { adapterVersion: ROBOFLOW_ADAPTER_VERSION };

  if (!isRecord(raw)) return { ...base, status: "inconclusive", inconclusiveReason: "not_an_object", dropped };
  if (!Array.isArray(raw.frames)) {
    return { ...base, status: "inconclusive", inconclusiveReason: "missing_frames_array", dropped };
  }

  const frames: PoseFrame[] = [];
  for (const rawFrame of raw.frames) {
    if (
      !isRecord(rawFrame) ||
      !isFiniteNumber(rawFrame.frame_index) ||
      !isFiniteNumber(rawFrame.timestamp_seconds) ||
      rawFrame.timestamp_seconds < 0
    ) {
      dropped.frames++;
      continue;
    }

    const keypoints: PoseFrame["keypoints"] = {};
    if (isRecord(rawFrame.keypoints)) {
      for (const [name, rawKp] of Object.entries(rawFrame.keypoints)) {
        const kp = parseKeypoint(rawKp);
        if (!isPoseKeypointName(name) || kp === null) {
          dropped.keypoints++;
          continue;
        }
        keypoints[name] = kp;
      }
    }

    const pc = rawFrame.person_confidence;
    frames.push({
      frameIndex: rawFrame.frame_index,
      timestampSeconds: rawFrame.timestamp_seconds,
      personConfidence: isFiniteNumber(pc) && pc >= 0 && pc <= 1 ? pc : null,
      // A frame with zero keypoints is kept: deciding it's unusable is the
      // quality gate's job, not the adapter's.
      keypoints,
    });
  }

  if (frames.length === 0) return { ...base, status: "inconclusive", inconclusiveReason: "no_valid_frames", dropped };

  // V1 merges a coarse pass and a dense impact-window pass; it sorts them,
  // but sort again rather than trust stored order. Stable sort keeps
  // equal-timestamp frames in stored order.
  frames.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const video = isRecord(raw.video) ? raw.video : {};
  const fps = video.analysis_fps;
  // V1 stores only frames that came back from Roboflow. frames_requested
  // counts the coarse pass; the dense impact pass only records how many
  // succeeded, so its failures are invisible and the total is a lower bound.
  const coarseRequested = video.frames_requested;
  const denseAnalyzed = video.dense_impact_window_frames_analyzed;
  const framesRequested = isFiniteNumber(coarseRequested)
    ? Math.max(frames.length, coarseRequested + (isFiniteNumber(denseAnalyzed) ? denseAnalyzed : 0))
    : null;

  return {
    ...base,
    status: "ok",
    dropped,
    sequence: {
      version: POSE_SEQUENCE_VERSION,
      backend: "roboflow_v1_workflow",
      // The model version inside the Roboflow workflow is set in the
      // Roboflow dashboard and was never recorded per analysis.
      backendVersion: null,
      coordinateSpace: "source_pixels",
      // Frame size was never stored for V1 analyses.
      sourceWidth: null,
      sourceHeight: null,
      analysisFps: isFiniteNumber(fps) && fps > 0 ? fps : null,
      framesRequested,
      frames,
    },
  };
}
