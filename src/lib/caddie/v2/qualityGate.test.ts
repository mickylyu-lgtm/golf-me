import { describe, expect, it } from "vitest";
import { QG_MIN_USABLE_FRAMES, assessFrameQuality, runQualityGate } from "./qualityGate.ts";
import { FACE_ON_ADDRESS, makeFrame, makeFrames, makeSequence, only } from "./testFixtures.ts";

describe("assessFrameQuality", () => {
  it("accepts a frame with a fully tracked golfer", () => {
    expect(assessFrameQuality(makeFrame(0, 0, FACE_ON_ADDRESS))).toEqual({ usable: true, confidentKeypoints: 13 });
  });

  it("rejects a frame with no keypoints as no_person (the V1 'zero keypoints counts as success' gap)", () => {
    expect(assessFrameQuality(makeFrame(0, 0, {}))).toMatchObject({ usable: false, reason: "no_person" });
  });

  it("rejects a low person score", () => {
    const frame = makeFrame(0, 0, FACE_ON_ADDRESS, { personConfidence: 0.2 });
    expect(assessFrameQuality(frame)).toMatchObject({ usable: false, reason: "low_person_confidence" });
  });

  it("does not reject on a missing person score", () => {
    const frame = makeFrame(0, 0, FACE_ON_ADDRESS, { personConfidence: null });
    expect(assessFrameQuality(frame).usable).toBe(true);
  });

  it("rejects low-confidence keypoints as too_few_keypoints", () => {
    const frame = makeFrame(0, 0, FACE_ON_ADDRESS, { confidence: 0.3 });
    expect(assessFrameQuality(frame)).toMatchObject({ usable: false, reason: "too_few_keypoints", confidentKeypoints: 0 });
  });

  it("rejects a frame with only a few joints", () => {
    const frame = makeFrame(0, 0, only(FACE_ON_ADDRESS, ["nose", "left_wrist", "right_wrist", "left_elbow"]));
    expect(assessFrameQuality(frame)).toMatchObject({ usable: false, reason: "too_few_keypoints" });
  });

  it("rejects a frame whose torso isn't visible even if limbs are", () => {
    const frame = makeFrame(
      0,
      0,
      only(FACE_ON_ADDRESS, [
        "nose",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
        "left_hip",
      ]),
    );
    expect(assessFrameQuality(frame)).toMatchObject({ usable: false, reason: "torso_not_visible" });
  });
});

describe("runQualityGate", () => {
  it("passes a clean sequence", () => {
    const result = runQualityGate(makeSequence(makeFrames(12, FACE_ON_ADDRESS)));
    expect(result.status).toBe("pass");
    expect(result.inconclusiveReason).toBeNull();
    expect(result.usableRatio).toBe(1);
    expect(result.usableFrameIndices).toHaveLength(12);
  });

  it("is inconclusive for an empty sequence", () => {
    const result = runQualityGate(makeSequence([]));
    expect(result).toMatchObject({ status: "inconclusive", inconclusiveReason: "empty_sequence", confidence: 0 });
  });

  it("is inconclusive when every frame is empty, even though all 'succeeded'", () => {
    const result = runQualityGate(makeSequence(makeFrames(20, {})));
    expect(result).toMatchObject({ status: "inconclusive", inconclusiveReason: "too_few_usable_frames" });
    expect(result.rejectCounts.no_person).toBe(20);
  });

  it("is inconclusive with too few usable frames", () => {
    const result = runQualityGate(makeSequence(makeFrames(QG_MIN_USABLE_FRAMES - 1, FACE_ON_ADDRESS)));
    expect(result.inconclusiveReason).toBe("too_few_usable_frames");
  });

  it("is inconclusive when usable frames are a minority", () => {
    const frames = [...makeFrames(10, FACE_ON_ADDRESS), ...makeFrames(12, {})].map((f, i) => ({ ...f, frameIndex: i }));
    const result = runQualityGate(makeSequence(frames));
    expect(result.inconclusiveReason).toBe("usable_ratio_too_low");
    expect(result.usableRatio).toBeCloseTo(10 / 22);
  });

  it("counts frames the producer dropped (framesRequested) as unusable", () => {
    const result = runQualityGate(makeSequence(makeFrames(10, FACE_ON_ADDRESS), { framesRequested: 30 }));
    expect(result.totalFrames).toBe(30);
    expect(result.missingFrames).toBe(20);
    expect(result.inconclusiveReason).toBe("usable_ratio_too_low");
  });
});
