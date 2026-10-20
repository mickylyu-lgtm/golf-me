import { describe, expect, it } from "vitest";
import { classifyCameraAngle, measureFrameGeometry } from "./cameraAngle.ts";
import { DTL_ADDRESS, FACE_ON_ADDRESS, OBLIQUE_ADDRESS, makeFrame, makeFrames, makeSequence } from "./testFixtures.ts";
import type { PoseKeypointName } from "./types.ts";

type Points = Record<PoseKeypointName, [number, number]>;

/** Scale and shift every point: ratios must not change. */
function transform(points: Points, scale: number, dx: number, dy: number): Points {
  const out = {} as Points;
  for (const [name, [x, y]] of Object.entries(points) as [PoseKeypointName, [number, number]][]) {
    out[name] = [x * scale + dx, y * scale + dy];
  }
  return out;
}

/** Rotate a figure 90 degrees (e.g. a sideways video): torso becomes horizontal. */
function rotate90(points: Points): Points {
  const out = {} as Points;
  for (const [name, [x, y]] of Object.entries(points) as [PoseKeypointName, [number, number]][]) out[name] = [y, -x];
  return out;
}

describe("measureFrameGeometry", () => {
  it("is scale- and translation-invariant", () => {
    const a = measureFrameGeometry(makeFrame(0, 0, FACE_ON_ADDRESS));
    const b = measureFrameGeometry(makeFrame(0, 0, transform(FACE_ON_ADDRESS, 0.004, 0.1, 0.05))); // ~normalized coords
    expect(a).not.toBeNull();
    expect(b?.shoulderRatio).toBeCloseTo(a!.shoulderRatio);
    expect(b?.hipRatio).toBeCloseTo(a!.hipRatio);
  });

  it("returns null when a torso point is missing or low-confidence", () => {
    const { left_hip: _omit, ...noHip } = FACE_ON_ADDRESS;
    void _omit;
    expect(measureFrameGeometry(makeFrame(0, 0, noHip))).toBeNull();
    expect(measureFrameGeometry(makeFrame(0, 0, FACE_ON_ADDRESS, { confidence: 0.4 }))).toBeNull();
  });

  it("returns null for a sideways or upside-down torso", () => {
    expect(measureFrameGeometry(makeFrame(0, 0, rotate90(FACE_ON_ADDRESS)))).toBeNull();
    expect(measureFrameGeometry(makeFrame(0, 0, transform(FACE_ON_ADDRESS, -1, 400, 400)))).toBeNull();
  });
});

describe("classifyCameraAngle", () => {
  it("classifies a face-on address", () => {
    const result = classifyCameraAngle(makeSequence(makeFrames(10, FACE_ON_ADDRESS)));
    expect(result).toMatchObject({ angle: "face_on", confidence: 1, inconclusiveReason: null, framesMeasured: 5 });
  });

  it("classifies a down-the-line address", () => {
    const result = classifyCameraAngle(makeSequence(makeFrames(10, DTL_ADDRESS)));
    expect(result).toMatchObject({ angle: "down_the_line", confidence: 1, inconclusiveReason: null });
  });

  it("returns unknown for an oblique angle instead of guessing", () => {
    const result = classifyCameraAngle(makeSequence(makeFrames(10, OBLIQUE_ADDRESS)));
    expect(result).toMatchObject({ angle: "unknown", confidence: 0, inconclusiveReason: "ambiguous_geometry" });
    expect(result.votes.ambiguous).toBe(5);
  });

  it("returns unknown when address frames disagree", () => {
    const frames = [
      makeFrame(0, 0, FACE_ON_ADDRESS),
      makeFrame(1, 0.125, DTL_ADDRESS),
      makeFrame(2, 0.25, FACE_ON_ADDRESS),
      makeFrame(3, 0.375, DTL_ADDRESS),
    ];
    const result = classifyCameraAngle(makeSequence(frames));
    expect(result).toMatchObject({ angle: "unknown", inconclusiveReason: "frames_disagree" });
  });

  it("tolerates a minority of dissenting frames", () => {
    const frames = [...makeFrames(4, FACE_ON_ADDRESS), makeFrame(4, 0.5, OBLIQUE_ADDRESS)];
    const result = classifyCameraAngle(makeSequence(frames));
    expect(result.angle).toBe("face_on");
    expect(result.confidence).toBeCloseTo(0.8);
  });

  it("returns unknown with too few measurable frames", () => {
    expect(classifyCameraAngle(makeSequence(makeFrames(2, FACE_ON_ADDRESS)))).toMatchObject({
      angle: "unknown",
      inconclusiveReason: "insufficient_frames",
    });
    expect(classifyCameraAngle(makeSequence([]))).toMatchObject({ angle: "unknown", framesConsidered: 0 });
    expect(classifyCameraAngle(makeSequence(makeFrames(10, {})))).toMatchObject({ inconclusiveReason: "insufficient_frames" });
  });

  it("uses frames near the address hint, not the clip start", () => {
    // Clip starts mid-swing (narrow, DTL-looking geometry), address is at 1.0 s.
    const frames = [
      ...makeFrames(6, DTL_ADDRESS),
      ...[0.875, 1.0, 1.125].map((t, i) => makeFrame(6 + i, t, FACE_ON_ADDRESS)),
    ];
    expect(classifyCameraAngle(makeSequence(frames)).angle).toBe("down_the_line");
    expect(classifyCameraAngle(makeSequence(frames), { addressTimeSeconds: 1.0 }).angle).toBe("face_on");
  });
});
