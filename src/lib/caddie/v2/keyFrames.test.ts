import { describe, expect, it } from "vitest";
import { detectKeyFrames, keyFramesToSwingSegments } from "./keyFrames.ts";
import type { KeyFrameDetection, KeyFrameResult } from "./keyFrames.ts";
import { analyzedRangeOf, validatePhaseOrder } from "./phaseOrder.ts";
import { DTL_ADDRESS, FACE_ON_ADDRESS, makeSequence } from "./testFixtures.ts";
import { POSE_KEYPOINT_NAMES } from "./types.ts";
import type { PoseFrame, PoseKeypointName, PoseSequence } from "./types.ts";

// Synthetic swings only: a stick figure whose hands follow a scripted path.
// Torso length of both fixtures is about 120 px (FACE_ON: shoulder mid y 100,
// hip mid y 220), so a 190 px hand rise is about 1.6 torso lengths, close to
// what MediaPipe showed on real swings.

type Points = Record<PoseKeypointName, [number, number]>;

const FPS = 60;
/** Script, in seconds: still address, backswing, downswing, follow-through, held finish. */
const T = { takeaway: 1.0, top: 1.8, impact: 2.05, finish: 2.45, end: 3.2 };
const TRUTH = { address: 60, top: 108, impact: 123, finish: 147 };

const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** Hand offset from address (pixels; up = negative y) at time t. `back` is the screen direction of the backswing. */
function handOffset(t: number, back: number, timing = T): [number, number] {
  const TOP: [number, number] = [70 * back, -190];
  const FIN: [number, number] = [-60 * back, -180];
  if (t <= timing.takeaway) return [0, 0];
  if (t <= timing.top) {
    const u = ease((t - timing.takeaway) / (timing.top - timing.takeaway));
    return [TOP[0] * u, TOP[1] * u];
  }
  if (t <= timing.impact) {
    const u = ease((t - timing.top) / (timing.impact - timing.top));
    return [TOP[0] * (1 - u), TOP[1] * (1 - u)];
  }
  if (t <= timing.finish) {
    const u = ease((t - timing.impact) / (timing.finish - timing.impact));
    return [FIN[0] * u, FIN[1] * u];
  }
  return FIN;
}

/** Deterministic pseudo-random noise in [-1, 1]. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

interface SwingOptions {
  body?: Points;
  /** Screen direction the hands go back: -1 = toward screen-left. FACE_ON's right shoulder is screen-left. */
  back?: number;
  fps?: number;
  start?: number;
  end?: number;
  jitterPx?: number;
  timing?: typeof T;
  /** Per-frame edits after the figure is built. */
  edit?: (frame: PoseFrame, i: number) => void;
  /** Extra hand offset added on top of the script (e.g. a second swing). */
  extra?: (t: number) => [number, number];
}

function swing(opts: SwingOptions = {}): PoseSequence {
  const body = opts.body ?? FACE_ON_ADDRESS;
  const fps = opts.fps ?? FPS;
  const start = opts.start ?? 0;
  const end = opts.end ?? T.end;
  const frames: PoseFrame[] = [];
  for (let i = Math.round(start * fps); i <= Math.round(end * fps); i++) {
    const t = i / fps;
    const [hx, hy] = handOffset(t, opts.back ?? -1, opts.timing ?? T);
    const [ex, ey] = opts.extra ? opts.extra(t) : [0, 0];
    const keypoints: PoseFrame["keypoints"] = {};
    POSE_KEYPOINT_NAMES.forEach((name, k) => {
      let [x, y] = body[name];
      if (name.endsWith("wrist")) {
        x += hx + ex;
        y += hy + ey;
      } else if (name.endsWith("elbow")) {
        x += (hx + ex) / 2;
        y += (hy + ey) / 2;
      }
      const j = opts.jitterPx ?? 0;
      keypoints[name] = { x: x + j * noise(i * 31 + k), y: y + j * noise(i * 17 + k + 1000), confidence: 0.9 };
    });
    const frame: PoseFrame = { frameIndex: i, timestampSeconds: t, personConfidence: null, keypoints };
    opts.edit?.(frame, i);
    frames.push(frame);
  }
  return makeSequence(frames, { analysisFps: fps, sourceWidth: 720, sourceHeight: 1280, framesRequested: frames.length });
}

function frameOf(d: KeyFrameDetection): number | null {
  return d.status === "detected" ? d.frameIndex : null;
}

/**
 * Address is biased LATE by design: the takeaway starts slowly (eased here,
 * and in real swings), and the first few frames of motion are below the
 * stillness threshold. Accept up to 0.1 s late, never early. This bias is a
 * known weakness to measure against K00 labels.
 */
const ADDRESS_LATE_TOLERANCE = 6;

function expectNear(r: KeyFrameResult, tolerance: number) {
  for (const [name, truth] of Object.entries(TRUTH) as [keyof typeof TRUTH, number][]) {
    const f = frameOf(r.keyFrames[name]);
    expect(f, name).not.toBeNull();
    if (name === "address") {
      expect(f as number, `address: got ${f}, truth ${truth}`).toBeGreaterThanOrEqual(truth - tolerance);
      expect(f as number, `address: got ${f}, truth ${truth}`).toBeLessThanOrEqual(truth + ADDRESS_LATE_TOLERANCE);
      continue;
    }
    expect(Math.abs((f as number) - truth), `${name}: got ${f}, truth ${truth}`).toBeLessThanOrEqual(tolerance);
  }
}

const dropWrists = (from: number, to: number) => (f: PoseFrame, i: number) => {
  if (i >= from && i <= to) {
    delete f.keypoints.left_wrist;
    delete f.keypoints.right_wrist;
  }
};

describe("detectKeyFrames: clean swings", () => {
  it("finds address, top, impact and finish face-on, in order, within 2 frames (address: late bias)", () => {
    const r = detectKeyFrames(swing(), { handedness: "right", cameraAngle: "face_on" });
    expect(r.status).toBe("detected");
    expect(r.inconclusiveReason).toBeNull();
    expectNear(r, 2);
    const idx = Object.values(r.keyFrames).map(frameOf) as number[];
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    for (const d of Object.values(r.keyFrames)) expect(d.confidence).toBeGreaterThan(0.5);
    expect(r.keyFrames.finish.status === "detected" && r.keyFrames.finish.held).toBe(true);
    expect(r.handednessCheck).toBe("consistent");
    expect(r.diagnostics.swingCandidates).toHaveLength(1);
  });

  it("is deterministic", () => {
    expect(detectKeyFrames(swing({ jitterPx: 3 }))).toEqual(detectKeyFrames(swing({ jitterPx: 3 })));
  });

  it("works down-the-line (hands move mostly vertically, wrists overlap)", () => {
    const r = detectKeyFrames(swing({ body: DTL_ADDRESS, back: 0.3 }), { handedness: "right", cameraAngle: "down_the_line" });
    expect(r.status).toBe("detected");
    expectNear(r, 2);
    expect(r.handednessCheck).toBe("not_checkable");
  });

  it("works for a left-handed golfer (mirrored swing) and flags a handedness contradiction", () => {
    // Left/right swapped: the trail (left) shoulder of a left-hander is screen-left here, so the hands go back toward -x.
    const mirrored = {} as Points;
    for (const name of POSE_KEYPOINT_NAMES) mirrored[name] = [280 - FACE_ON_ADDRESS[name][0], FACE_ON_ADDRESS[name][1]];
    const lefty = swing({ body: mirrored, back: -1 });
    const ok = detectKeyFrames(lefty, { handedness: "left", cameraAngle: "face_on" });
    expect(ok.status).toBe("detected");
    expectNear(ok, 2);
    expect(ok.handednessCheck).toBe("consistent");

    const wrong = detectKeyFrames(lefty, { handedness: "right", cameraAngle: "face_on" });
    expect(wrong.handednessCheck).toBe("contradicts");
    expect(wrong.keyFrames.top.confidence).toBeCloseTo(ok.keyFrames.top.confidence / 2, 2);
  });

  it("is resolution- and distance-independent", () => {
    const small = swing({
      edit: (f) => {
        for (const kp of Object.values(f.keypoints)) {
          if (!kp) continue;
          kp.x = kp.x * 0.4 + 50;
          kp.y = kp.y * 0.4 + 300;
        }
      },
    });
    expectNear(detectKeyFrames(small), 2);
  });
});

describe("detectKeyFrames: jitter, blur, glitches", () => {
  it("tolerates landmark jitter of a few pixels", () => {
    const r = detectKeyFrames(swing({ jitterPx: 4 }), { handedness: "right", cameraAngle: "face_on" });
    expect(r.status).toBe("detected");
    // 4 frames at 60 fps = 67 ms, the report template's key-frame tolerance. The top is a flat plateau, so jitter moves it most.
    expectNear(r, 4);
  });

  it("bridges a short downswing blur gap (wrists missing for 5 frames) and says so", () => {
    const r = detectKeyFrames(swing({ edit: dropWrists(113, 117) }));
    expect(r.status).toBe("detected");
    expect(r.diagnostics.interpolatedFrames).toBe(5);
    expectNear(r, 2);
  });

  it("treats low-confidence wrists as missing, each wrist on its own", () => {
    // Far wrist hidden for the whole clip (down-the-line); the near wrist alone carries the swing.
    const r = detectKeyFrames(
      swing({
        body: DTL_ADDRESS,
        back: 0.3,
        edit: (f) => {
          f.keypoints.left_wrist = { ...(f.keypoints.left_wrist as NonNullable<PoseFrame["keypoints"]["left_wrist"]>), confidence: 0.04 };
        },
      }),
    );
    expect(r.status).toBe("detected");
    expectNear(r, 2);
  });

  it("never reports an impact that falls inside a long gap", () => {
    const r = detectKeyFrames(swing({ edit: dropWrists(118, 130) })); // 13 frames > KF_MAX_GAP_SECONDS
    expect(r.keyFrames.impact).toMatchObject({ status: "inconclusive", reason: "wrists_not_tracked_at_phase", frameIndex: null });
    expect(r.status).not.toBe("detected");
  });

  it("ignores a one-frame upside-down pose flip", () => {
    const clean = detectKeyFrames(swing());
    const flipped = detectKeyFrames(
      swing({
        edit: (f, i) => {
          if (i !== 118) return;
          for (const kp of Object.values(f.keypoints)) if (kp) kp.y = 600 - kp.y;
        },
      }),
    );
    expect(Object.values(flipped.keyFrames).map(frameOf)).toEqual(Object.values(clean.keyFrames).map(frameOf));
  });

  it("uses the lead wrist when the two wrists disagree and handedness is known", () => {
    // Right wrist (trail, right-hander) mis-tracked far away in the middle of the swing.
    const r = detectKeyFrames(
      swing({
        edit: (f, i) => {
          if (i >= 90 && i <= 130) f.keypoints.right_wrist = { x: 400, y: 380, confidence: 0.95 };
        },
      }),
      { handedness: "right" },
    );
    expectNear(r, 2);
  });
});

describe("detectKeyFrames: inconclusive, never fabricated", () => {
  const expectAll = (r: KeyFrameResult, reason: string) => {
    expect(r.status).toBe("inconclusive");
    expect(r.inconclusiveReason).toBe(reason);
    for (const d of Object.values(r.keyFrames)) expect(d).toMatchObject({ status: "inconclusive", frameIndex: null, confidence: 0, reason });
  };

  it("too short", () => {
    expectAll(detectKeyFrames(swing({ start: 1.0, end: 1.6 })), "too_short");
    expectAll(detectKeyFrames(makeSequence([])), "too_short");
  });

  it("no swing motion: a golfer standing still", () => {
    expectAll(detectKeyFrames(swing({ timing: { takeaway: 99, top: 100, impact: 101, finish: 102, end: 3.2 } })), "no_swing_motion");
  });

  it("wrists not tracked", () => {
    expectAll(detectKeyFrames(swing({ edit: dropWrists(0, 1e9) })), "wrists_not_tracked");
  });

  it("partial body: hips out of frame", () => {
    expectAll(
      detectKeyFrames(
        swing({
          edit: (f) => {
            delete f.keypoints.left_hip;
            delete f.keypoints.right_hip;
          },
        }),
      ),
      "partial_body",
    );
  });

  it("multiple swings: a practice swing and the real one", () => {
    const second = { takeaway: 4.0, top: 4.8, impact: 5.05, finish: 5.45, end: 6.4 };
    const seq = swing({
      end: 6.4,
      extra: (t) => {
        if (t < 3.6) return [0, 0];
        // Undo the first swing's held finish, then script the second swing.
        const [fx, fy] = handOffset(t, -1, T);
        const [sx, sy] = handOffset(t, -1, second);
        const back = ease((t - 3.2) / 0.4);
        return [sx - fx * back, sy - fy * back];
      },
    });
    expectAll(detectKeyFrames(seq), "multiple_swings");
  });

  it("multiple people during the swing", () => {
    const seq = swing();
    const multi = seq.frames.filter((f) => f.frameIndex >= 70 && f.frameIndex <= 140).map((f) => f.frameIndex);
    expectAll(detectKeyFrames(seq, { multiPersonFrameIndices: multi }), "multiple_people");
    // A couple of stray frames are fine.
    expect(detectKeyFrames(seq, { multiPersonFrameIndices: [100, 101] }).status).toBe("detected");
  });

  it("tracking jump: the body centre leaps mid-swing", () => {
    const r = detectKeyFrames(
      swing({
        edit: (f, i) => {
          if (i < 100) return;
          for (const kp of Object.values(f.keypoints)) if (kp) kp.x += 300;
        },
      }),
    );
    expectAll(r, "tracking_jump");
  });

  it("address not in clip when the clip starts after the takeaway", () => {
    const r = detectKeyFrames(swing({ start: 1.3 }));
    expect(r.status).toBe("partial");
    expect(r.keyFrames.address).toMatchObject({ status: "inconclusive", reason: "not_in_clip" });
    expect(frameOf(r.keyFrames.top)).toBeCloseTo(TRUTH.top, -1);
  });

  it("finish not in clip when the clip ends during the follow-through", () => {
    const r = detectKeyFrames(swing({ end: 2.3 }));
    expect(r.keyFrames.finish).toMatchObject({ status: "inconclusive", reason: "not_in_clip" });
    expect(r.keyFrames.impact.status).toBe("detected");
  });

  it("a finish that is never held falls back to the follow-through peak, at reduced confidence", () => {
    // Hands rise to the finish, then drop straight back down without holding.
    const seq = swing({
      extra: (t) => (t <= T.finish ? [0, 0] : [0, 180 * ease((t - T.finish) / 0.3)]),
    });
    const r = detectKeyFrames(seq);
    const fin = r.keyFrames.finish;
    expect(fin.status).toBe("detected");
    if (fin.status === "detected") {
      expect(fin.held).toBe(false);
      expect(Math.abs(fin.frameIndex - TRUTH.finish)).toBeLessThanOrEqual(2);
      expect(fin.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it("impact is not reported at a low sampling rate", () => {
    const r = detectKeyFrames(swing({ fps: 12 }));
    expect(r.keyFrames.impact).toMatchObject({ status: "inconclusive", reason: "frame_rate_too_low" });
  });
});

describe("keyFramesToSwingSegments", () => {
  it("produces segments that pass the phase-order check", () => {
    const seq = swing();
    const r = detectKeyFrames(seq);
    const segs = keyFramesToSwingSegments(r, seq);
    expect(segs.backswing).toBeNull();
    expect(segs.downswing).toBeNull();
    expect(segs.impact?.windowEndSeconds).toBeGreaterThan(segs.impact?.windowStartSeconds as number);
    expect(validatePhaseOrder(segs, analyzedRangeOf(seq.frames)).status).toBe("consistent");
  });

  it("leaves inconclusive key frames null", () => {
    const seq = swing({ start: 1.3 });
    const segs = keyFramesToSwingSegments(detectKeyFrames(seq), seq);
    expect(segs.address).toBeNull();
    expect(segs.top).not.toBeNull();
  });
});
