import { describe, expect, it } from "vitest";
import { adaptV1RoboflowPoseData } from "./roboflowAdapter.ts";

// Synthetic object in the shape analyze-swing persists as
// roboflow_analysis_json (trustedPoseData). Values are made up.
function v1Row() {
  return {
    video: { analysis_fps: 8, frames_requested: 4, frames_analyzed: 3, dense_impact_window_frames_analyzed: 1 },
    frames: [
      {
        frame_index: 4,
        timestamp_seconds: 0.3,
        person_confidence: 0.9,
        keypoints: { left_wrist: { x: 10, y: 20, confidence: 0.8 } },
        body_metrics: { spine_lean_degrees: 30 },
      },
      {
        frame_index: 0,
        timestamp_seconds: 0,
        person_confidence: null,
        keypoints: {
          left_shoulder: { x: 1, y: 2, confidence: 0.7 },
          left_club_head: { x: 5, y: 5, confidence: 0.9 }, // not a body keypoint
          right_hip: { x: "3", y: 4, confidence: 0.6 }, // malformed
        },
        body_metrics: {},
      },
      { frame_index: 1, timestamp_seconds: 0.125, person_confidence: 0.8, keypoints: {}, body_metrics: {} },
      { frame_index: 2, timestamp_seconds: null, keypoints: {} }, // no timestamp: dropped
    ],
    limitations: [],
  };
}

describe("adaptV1RoboflowPoseData", () => {
  it("converts the stored V1 shape into a sorted PoseSequence", () => {
    const result = adaptV1RoboflowPoseData(v1Row());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const seq = result.sequence;
    expect(seq.version).toBe(1);
    expect(seq.backend).toBe("roboflow_v1_workflow");
    expect(seq.backendVersion).toBeNull();
    expect(seq.coordinateSpace).toBe("source_pixels");
    expect(seq.sourceWidth).toBeNull();
    expect(seq.analysisFps).toBe(8);
    expect(seq.frames.map((f) => f.frameIndex)).toEqual([0, 1, 4]);
    expect(seq.frames[0].keypoints).toEqual({ left_shoulder: { x: 1, y: 2, confidence: 0.7 } });
    expect(seq.frames[0].personConfidence).toBeNull();
    expect(seq.frames[2].keypoints.left_wrist).toEqual({ x: 10, y: 20, confidence: 0.8 });
  });

  it("counts what it drops instead of repairing it", () => {
    const result = adaptV1RoboflowPoseData(v1Row());
    expect(result.dropped).toEqual({ frames: 1, keypoints: 2 });
  });

  it("keeps zero-keypoint frames so the quality gate can reject them", () => {
    const result = adaptV1RoboflowPoseData(v1Row());
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.sequence.frames.find((f) => f.frameIndex === 1)?.keypoints).toEqual({});
  });

  it("derives framesRequested from coarse requests plus dense frames", () => {
    const result = adaptV1RoboflowPoseData(v1Row());
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.sequence.framesRequested).toBe(5);
  });

  it("leaves fps and framesRequested null when the video block is missing", () => {
    const row = v1Row() as Record<string, unknown>;
    delete row.video;
    const result = adaptV1RoboflowPoseData(row);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.sequence.analysisFps).toBeNull();
    expect(result.sequence.framesRequested).toBeNull();
  });

  it("rejects out-of-range confidences", () => {
    const result = adaptV1RoboflowPoseData({
      frames: [{ frame_index: 0, timestamp_seconds: 0, person_confidence: 2, keypoints: { nose: { x: 1, y: 1, confidence: 1.5 } } }],
    });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.sequence.frames[0].keypoints).toEqual({});
    expect(result.sequence.frames[0].personConfidence).toBeNull();
    expect(result.dropped.keypoints).toBe(1);
  });

  it.each([
    [null, "not_an_object"],
    [[], "not_an_object"],
    ["frames", "not_an_object"],
    [{}, "missing_frames_array"],
    [{ frames: {} }, "missing_frames_array"],
    [{ frames: [] }, "no_valid_frames"],
    [{ frames: [{ frame_index: 0 }] }, "no_valid_frames"],
  ])("is inconclusive for %j", (input, reason) => {
    const result = adaptV1RoboflowPoseData(input);
    expect(result.status).toBe("inconclusive");
    if (result.status === "inconclusive") expect(result.inconclusiveReason).toBe(reason);
  });
});
