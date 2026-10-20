import { describe, expect, it } from "vitest";
import { classifyCameraAngle } from "./cameraAngle.ts";
import {
  MEDIAPIPE_ADAPTER_VERSION,
  MEDIAPIPE_LANDMARK_COUNT,
  MEDIAPIPE_LANDMARK_INDEX,
  adaptMediaPipeRun,
} from "./mediapipeAdapter.ts";
import type { MediaPipeLandmarkTuple, MediaPipeRawFrame, MediaPipeRawRun } from "./mediapipeAdapter.ts";
import { runQualityGate } from "./qualityGate.ts";
import { DTL_ADDRESS, FACE_ON_ADDRESS } from "./testFixtures.ts";
import { POSE_KEYPOINT_NAMES } from "./types.ts";
import type { PoseKeypointName } from "./types.ts";

// Synthetic only: the stick figures from testFixtures.ts, placed in a
// portrait 720x1280 frame and expressed as MediaPipe-style normalized
// landmarks. No real pose output.
const W = 720;
const H = 1280;

type Points = Record<PoseKeypointName, [number, number]>;

function pose(points: Points, opts: { visibility?: number; presence?: number | null; scale?: number; offset?: [number, number] } = {}) {
  const scale = opts.scale ?? 2;
  const [ox, oy] = opts.offset ?? [200, 300];
  const visibility = opts.visibility ?? 0.95;
  const presence = opts.presence === undefined ? 0.99 : opts.presence;
  // Unmapped landmarks (eyes, hands, feet) get a harmless in-frame filler.
  const lms: MediaPipeLandmarkTuple[] = Array.from({ length: MEDIAPIPE_LANDMARK_COUNT }, () => [0.5, 0.5, 0, 0.1, 0.1]);
  for (const name of POSE_KEYPOINT_NAMES) {
    const [px, py] = points[name];
    lms[MEDIAPIPE_LANDMARK_INDEX[name]] = [(ox + px * scale) / W, (oy + py * scale) / H, 0, visibility, presence];
  }
  return lms;
}

function run(frames: MediaPipeRawFrame[], overrides: Partial<MediaPipeRawRun> = {}): MediaPipeRawRun {
  return {
    model: "pose_landmarker_full",
    runtimeVersion: "1.1.0",
    frameWidth: W,
    frameHeight: H,
    analysisFps: 30,
    framesRequested: frames.length,
    frames,
    ...overrides,
  };
}

function frames(n: number, make: (i: number) => MediaPipeLandmarkTuple[][]): MediaPipeRawFrame[] {
  return Array.from({ length: n }, (_, i) => ({ frameIndex: i, timestampSeconds: i / 30, poses: make(i) }));
}

describe("adaptMediaPipeRun", () => {
  it("maps the 13 BlazePose landmarks to our keypoints in source pixels", () => {
    const r = adaptMediaPipeRun(run(frames(1, () => [pose(FACE_ON_ADDRESS)])));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.adapterVersion).toBe(MEDIAPIPE_ADAPTER_VERSION);
    const s = r.sequence;
    expect(s.backend).toBe("mediapipe_pose_landmarker");
    expect(s.backendVersion).toBe("pose_landmarker_full@tasks-vision-1.1.0");
    expect(s.coordinateSpace).toBe("source_pixels");
    expect([s.sourceWidth, s.sourceHeight]).toEqual([W, H]);
    const kps = s.frames[0].keypoints;
    expect(Object.keys(kps).sort()).toEqual([...POSE_KEYPOINT_NAMES].sort());
    // left_shoulder fixture (180,100) -> 200 + 360, 300 + 200
    expect(kps.left_shoulder?.x).toBeCloseTo(560, 6);
    expect(kps.left_shoulder?.y).toBeCloseTo(500, 6);
    expect(s.frames[0].personConfidence).toBeNull();
  });

  it("uses min(visibility, presence) as confidence, or visibility when presence is absent", () => {
    const a = adaptMediaPipeRun(run(frames(1, () => [pose(FACE_ON_ADDRESS, { visibility: 0.9, presence: 0.4 })])));
    const b = adaptMediaPipeRun(run(frames(1, () => [pose(FACE_ON_ADDRESS, { visibility: 0.7, presence: null })])));
    expect(a.status === "ok" && a.sequence.frames[0].keypoints.nose?.confidence).toBeCloseTo(0.4, 6);
    expect(b.status === "ok" && b.sequence.frames[0].keypoints.nose?.confidence).toBeCloseTo(0.7, 6);
  });

  it("drops out-of-frame and non-finite landmarks instead of keeping guesses", () => {
    const p = pose(FACE_ON_ADDRESS);
    p[MEDIAPIPE_LANDMARK_INDEX.left_ankle] = [0.5, 1.2, 0, 0.9, 0.9];
    p[MEDIAPIPE_LANDMARK_INDEX.right_ankle] = [-0.01, 0.9, 0, 0.9, 0.9];
    p[MEDIAPIPE_LANDMARK_INDEX.nose] = [Number.NaN, 0.1, 0, 0.9, 0.9];
    const r = adaptMediaPipeRun(run(frames(1, () => [p])));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const kps = r.sequence.frames[0].keypoints;
    expect(kps.left_ankle).toBeUndefined();
    expect(kps.right_ankle).toBeUndefined();
    expect(kps.nose).toBeUndefined();
    expect(r.stats.keypointsOutOfFrame).toBe(2);
    expect(r.stats.keypointsNonFinite).toBe(1);
  });

  it("keeps no-pose frames empty so the quality gate rejects them as no_person", () => {
    const r = adaptMediaPipeRun(run(frames(12, (i) => (i < 4 ? [] : [pose(FACE_ON_ADDRESS)]))));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.sequence.frames).toHaveLength(12);
    expect(r.stats.framesWithNoPose).toBe(4);
    const gate = runQualityGate(r.sequence);
    expect(gate.rejectCounts.no_person).toBe(4);
    expect(gate.usableFrameIndices).toHaveLength(8);
  });

  it("keeps the largest pose when several are found and counts the frame", () => {
    const small = pose(DTL_ADDRESS, { scale: 0.5, offset: [20, 20] });
    const big = pose(FACE_ON_ADDRESS, { scale: 2 });
    const r = adaptMediaPipeRun(run(frames(1, () => [small, big])));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.stats.framesWithMultiplePoses).toBe(1);
    expect(r.sequence.frames[0].keypoints.left_shoulder?.x).toBeCloseTo(560, 6);
  });

  it("skips malformed poses and counts dropped frames as requested-but-unusable", () => {
    const raw = run(frames(3, () => [pose(FACE_ON_ADDRESS)]));
    raw.frames.push({ frameIndex: 3, timestampSeconds: -1, poses: [] });
    raw.frames[1].poses = [[[0.5, 0.5, 0, 0.9, 0.9]]];
    const r = adaptMediaPipeRun({ ...raw, framesRequested: 3 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.stats.framesDropped).toBe(1);
    expect(r.stats.posesMalformed).toBe(1);
    expect(r.sequence.frames).toHaveLength(3);
    expect(r.sequence.framesRequested).toBe(4);
  });

  it("rejects malformed runs", () => {
    expect(adaptMediaPipeRun(null).status).toBe("invalid");
    expect(adaptMediaPipeRun({ frames: "x" })).toMatchObject({ invalidReason: "missing_frames_array" });
    expect(adaptMediaPipeRun({ ...run([]), frameWidth: 0 })).toMatchObject({ invalidReason: "bad_frame_size" });
    const dup = run(frames(2, () => []));
    dup.frames[1].frameIndex = 0;
    expect(adaptMediaPipeRun(dup)).toMatchObject({ invalidReason: "duplicate_frame_index" });
  });

  it("sorts frames by time", () => {
    const f = frames(3, () => [pose(FACE_ON_ADDRESS)]).reverse();
    const r = adaptMediaPipeRun(run(f));
    expect(r.status === "ok" && r.sequence.frames.map((x) => x.frameIndex)).toEqual([0, 1, 2]);
  });

  it("feeds the camera-angle heuristic in a portrait frame without distortion", () => {
    const face = adaptMediaPipeRun(run(frames(10, () => [pose(FACE_ON_ADDRESS)])));
    const dtl = adaptMediaPipeRun(run(frames(10, () => [pose(DTL_ADDRESS)])));
    expect(face.status === "ok" && classifyCameraAngle(face.sequence).angle).toBe("face_on");
    expect(dtl.status === "ok" && classifyCameraAngle(dtl.sequence).angle).toBe("down_the_line");
  });
});
