// Key-frame detector: address, top of backswing, impact, finish
// (audit §7.2 step 5 "Segmenter"; LOCAL_PILOT_WORKFLOW.md step 10).
//
// Pure and deterministic: PoseSequence in, four frame indices out, each with a
// heuristic confidence or an explicit "inconclusive" with a reason. No
// network, no model, no LLM. It never fills in a key frame the evidence
// doesn't support; when in doubt it says inconclusive.
//
// Signal: the HAND point (the confident wrists; both hands hold the grip)
// relative to the hip centre, in torso lengths, so it is independent of
// resolution, distance, and a hand-held camera drifting. Height (image up =
// positive) carries most of the swing:
//
//   address  hands low and still, before the takeaway
//   top      hands highest before the fastest downward hand motion
//   impact   hands lowest after that downswing (bottom of the arc)
//   finish   first frame of a held (still) high-hands position after impact;
//            if never held, the highest hand point of the follow-through
//
// This works the same face-on and down-the-line, because hand HEIGHT rises
// and falls the same way in both views; handedness only matters for which
// wrist to trust when the two disagree and for a face-on direction check.
//
// Robustness:
// - each wrist is judged on its own (in down-the-line the far wrist is often
//   hidden at address while the near one is clear);
// - short gaps (downswing blur) are bridged by linear interpolation and
//   marked as such; long gaps stay gaps;
// - a running median smooths landmark jitter; speeds use a multi-frame
//   baseline;
// - frames with an upside-down torso (a one-frame pose flip) give no hand
//   evidence;
// - local evidence is checked around every key frame: if the hands were not
//   actually observed there, that key frame is inconclusive.
//
// Known limits (see docs/caddie-v2/MEDIAPIPE_POC.md): "top" is defined by
// coaches as the CLUB changing direction, which pose-only data can't see; the
// hands usually stop slightly earlier. "Impact" is the hands' lowest point, a
// proxy for contact. Both are expected to carry a systematic offset that only
// labeled clips (K00, then coaches) can measure.
//
// PROVISIONAL THRESHOLDS: all placeholders in thresholds.ts. No accuracy is
// claimed until scored against labels.

import { QG_MIN_KEYPOINT_CONFIDENCE } from "./qualityGate.ts";
import { thresholdValue } from "./thresholds.ts";
import type { PhaseConfidenceLabel, PoseFrame, PoseKeypoint, PoseSequence, SwingSegments } from "./types.ts";

export const KEY_FRAMES_VERSION = "0.1.0";

export const KF_MIN_WRIST_CONFIDENCE = thresholdValue("KF_MIN_WRIST_CONFIDENCE");
export const KF_MAX_WRIST_SEPARATION = thresholdValue("KF_MAX_WRIST_SEPARATION");
export const KF_MAX_GAP_SECONDS = thresholdValue("KF_MAX_GAP_SECONDS");
export const KF_SMOOTHING_WINDOW_SECONDS = thresholdValue("KF_SMOOTHING_WINDOW_SECONDS");
export const KF_SPEED_BASELINE_SECONDS = thresholdValue("KF_SPEED_BASELINE_SECONDS");
export const KF_MIN_CLIP_SECONDS = thresholdValue("KF_MIN_CLIP_SECONDS");
export const KF_MIN_HAND_RISE = thresholdValue("KF_MIN_HAND_RISE");
export const KF_MIN_DOWNSWING_SPEED = thresholdValue("KF_MIN_DOWNSWING_SPEED");
export const KF_MAX_DOWNSWING_SECONDS = thresholdValue("KF_MAX_DOWNSWING_SECONDS");
export const KF_MAX_IMPACT_SEARCH_SECONDS = thresholdValue("KF_MAX_IMPACT_SEARCH_SECONDS");
export const KF_STILL_MAX_SPEED = thresholdValue("KF_STILL_MAX_SPEED");
export const KF_MIN_STILL_SECONDS = thresholdValue("KF_MIN_STILL_SECONDS");
export const KF_MAX_ADDRESS_SEARCH_SECONDS = thresholdValue("KF_MAX_ADDRESS_SEARCH_SECONDS");
export const KF_MAX_FINISH_SEARCH_SECONDS = thresholdValue("KF_MAX_FINISH_SEARCH_SECONDS");
export const KF_LOCAL_WINDOW_SECONDS = thresholdValue("KF_LOCAL_WINDOW_SECONDS");
export const KF_MIN_LOCAL_COVERAGE = thresholdValue("KF_MIN_LOCAL_COVERAGE");
export const KF_MULTI_SWING_RATIO = thresholdValue("KF_MULTI_SWING_RATIO");
export const KF_MAX_MULTI_PERSON_RATIO = thresholdValue("KF_MAX_MULTI_PERSON_RATIO");
export const KF_MAX_BODY_JUMP = thresholdValue("KF_MAX_BODY_JUMP");
export const KF_MIN_IMPACT_FPS = thresholdValue("KF_MIN_IMPACT_FPS");

export const KEY_FRAME_NAMES = ["address", "top", "impact", "finish"] as const;
export type KeyFrameName = (typeof KEY_FRAME_NAMES)[number];

export type Handedness = "right" | "left";

/** Why the whole sequence yields no key frames. */
export type KeyFrameSequenceReason =
  | "too_short"
  /** Shoulders/hips not tracked well enough to set a body scale and centre (body partly out of frame, or no person). */
  | "partial_body"
  /** The torso is there but the wrists are mostly not observed. */
  | "wrists_not_tracked"
  /** Wrists tracked, but no rise-and-fall of the hands large and fast enough to be a swing. */
  | "no_swing_motion"
  /** Two separate, comparable swings (e.g. a practice swing): which one to analyze is ambiguous. */
  | "multiple_swings"
  /** Several people detected in too many swing frames. */
  | "multiple_people"
  /** The body centre jumped during the swing: tracking switched person or failed. */
  | "tracking_jump";

/** Why a single key frame is not reported. */
export type KeyFrameReason =
  | KeyFrameSequenceReason
  /** Address: the clip starts after the takeaway. Finish: the clip ends before the follow-through stops rising. */
  | "not_in_clip"
  /** No still period before the takeaway within the search window (e.g. continuous waggling). */
  | "no_still_address"
  /** After impact the hands never rose into a follow-through within the search window. */
  | "no_follow_through"
  /** The hands were not observed (only interpolated or missing) around this key frame. */
  | "wrists_not_tracked_at_phase"
  /** Impact only: sampling too sparse to place it. */
  | "frame_rate_too_low";

export type KeyFrameDetection =
  | {
      status: "detected";
      frameIndex: number;
      timestampSeconds: number;
      /** Heuristic 0..1, NOT a calibrated probability. */
      confidence: number;
      confidenceLabel: PhaseConfidenceLabel;
      /** Share of frames around it with an observed (not interpolated) hand point. */
      localCoverage: number;
      /** Finish only: true = a held finish was found; false = follow-through peak used instead. */
      held?: boolean;
    }
  | { status: "inconclusive"; frameIndex: null; timestampSeconds: null; confidence: 0; reason: KeyFrameReason };

export type HandednessCheck = "consistent" | "contradicts" | "not_checkable";

export interface KeyFrameOptions {
  /** The golfer's handedness, if known (capture metadata or profile). */
  handedness?: Handedness | null;
  /** From cameraAngle.ts (or the user); only "face_on" enables the direction check. */
  cameraAngle?: "face_on" | "down_the_line" | "unknown" | null;
  /** frameIndex values where the pose backend saw more than one person (MediaPipe adapter keeps only the largest). */
  multiPersonFrameIndices?: readonly number[] | null;
}

export interface KeyFrameResult {
  moduleVersion: string;
  /** detected: all four; partial: some; inconclusive: none. */
  status: "detected" | "partial" | "inconclusive";
  /** Set when the whole sequence is inconclusive. */
  inconclusiveReason: KeyFrameSequenceReason | null;
  keyFrames: Record<KeyFrameName, KeyFrameDetection>;
  handedness: Handedness | null;
  /** Face-on only: do the hands go back toward the trail side for this handedness? A contradiction halves every confidence. */
  handednessCheck: HandednessCheck;
  diagnostics: {
    frames: number;
    analysisFps: number | null;
    torsoLength: number | null;
    smoothingWindowFrames: number;
    /** Share of all frames with an observed hand point. */
    handCoverage: number;
    /** Frames bridged by interpolation. */
    interpolatedFrames: number;
    /** Hand height in torso lengths (hip centre = 0, up positive) at each detected key frame. */
    handHeight: Partial<Record<KeyFrameName, number>>;
    /** Swing candidates found (downswings), best first. */
    swingCandidates: { topFrameIndex: number; impactFrameIndex: number; drop: number; peakDownSpeed: number }[];
    multiPersonFramesInSwing: number;
    maxBodyJump: number | null;
  };
}

// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

function confident(frame: PoseFrame, name: keyof PoseFrame["keypoints"], min: number): PoseKeypoint | null {
  const kp = frame.keypoints[name];
  return kp && Number.isFinite(kp.x) && Number.isFinite(kp.y) && kp.confidence >= min ? kp : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function label(confidence: number): PhaseConfidenceLabel {
  return confidence >= 0.7 ? "high" : confidence >= 0.4 ? "medium" : "low";
}

/** Body centre: midpoint of the confident hips, or the one confident hip (hips nearly coincide down-the-line). */
function hipCentre(frame: PoseFrame): Point | null {
  const lh = confident(frame, "left_hip", QG_MIN_KEYPOINT_CONFIDENCE);
  const rh = confident(frame, "right_hip", QG_MIN_KEYPOINT_CONFIDENCE);
  if (lh && rh) return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  return lh ?? rh ?? null;
}

function torsoLengthOf(frame: PoseFrame): number | null {
  const ls = confident(frame, "left_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
  const rs = confident(frame, "right_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
  const lh = confident(frame, "left_hip", QG_MIN_KEYPOINT_CONFIDENCE);
  const rh = confident(frame, "right_hip", QG_MIN_KEYPOINT_CONFIDENCE);
  if (!ls || !rs || !lh || !rh) return null;
  const d = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  return d > 0 ? d : null;
}

/**
 * False when the frame's torso is upside down (shoulders at or below the
 * hips): a one-frame pose flip MediaPipe occasionally produces mid-swing.
 */
function torsoUpright(frame: PoseFrame, centre: Point): boolean {
  const ls = confident(frame, "left_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
  const rs = confident(frame, "right_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
  const sh = ls && rs ? (ls.y + rs.y) / 2 : (ls ?? rs)?.y;
  return sh === undefined || sh < centre.y;
}

/** The hand point for one frame from the confident wrists, or null. */
function handPoint(frame: PoseFrame, scale: number, handedness: Handedness | null): { p: Point; conf: number } | null {
  const lw = confident(frame, "left_wrist", KF_MIN_WRIST_CONFIDENCE);
  const rw = confident(frame, "right_wrist", KF_MIN_WRIST_CONFIDENCE);
  if (lw && rw) {
    if (Math.hypot(lw.x - rw.x, lw.y - rw.y) / scale <= KF_MAX_WRIST_SEPARATION) {
      return { p: { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 }, conf: Math.max(lw.confidence, rw.confidence) };
    }
    // One wrist is mis-tracked. Trust the lead wrist if handedness is known, else the more confident one.
    const lead = handedness === "right" ? lw : handedness === "left" ? rw : null;
    const pick = lead ?? (lw.confidence >= rw.confidence ? lw : rw);
    return { p: { x: pick.x, y: pick.y }, conf: pick.confidence };
  }
  const one = lw ?? rw;
  return one ? { p: { x: one.x, y: one.y }, conf: one.confidence } : null;
}

function inconclusive(reason: KeyFrameReason): KeyFrameDetection {
  return { status: "inconclusive", frameIndex: null, timestampSeconds: null, confidence: 0, reason };
}

function allInconclusive(reason: KeyFrameReason): Record<KeyFrameName, KeyFrameDetection> {
  return { address: inconclusive(reason), top: inconclusive(reason), impact: inconclusive(reason), finish: inconclusive(reason) };
}

/** Frames per second: the declared rate, else the median frame spacing. */
function effectiveFps(sequence: PoseSequence): number | null {
  if (sequence.analysisFps && sequence.analysisFps > 0) return sequence.analysisFps;
  const dts: number[] = [];
  for (let i = 1; i < sequence.frames.length; i++) {
    const dt = sequence.frames[i].timestampSeconds - sequence.frames[i - 1].timestampSeconds;
    if (dt > 0) dts.push(dt);
  }
  const m = median(dts);
  return m ? 1 / m : null;
}

const framesFor = (seconds: number, fps: number, min: number): number => Math.max(min, Math.round(seconds * fps));

/**
 * Detects the four key frames of one swing.
 * Frames are assumed sorted by time (the PoseSequence contract).
 */
export function detectKeyFrames(sequence: PoseSequence, options: KeyFrameOptions = {}): KeyFrameResult {
  const frames = sequence.frames;
  const n = frames.length;
  const handedness = options.handedness ?? null;
  const fps = effectiveFps(sequence);
  const t = frames.map((f) => f.timestampSeconds);
  const w = fps ? framesFor(KF_SMOOTHING_WINDOW_SECONDS, fps, 3) | 1 : 3;

  const diagnostics: KeyFrameResult["diagnostics"] = {
    frames: n,
    analysisFps: fps ? round3(fps) : null,
    torsoLength: null,
    smoothingWindowFrames: w,
    handCoverage: 0,
    interpolatedFrames: 0,
    handHeight: {},
    swingCandidates: [],
    multiPersonFramesInSwing: 0,
    maxBodyJump: null,
  };
  const fail = (reason: KeyFrameSequenceReason): KeyFrameResult => ({
    moduleVersion: KEY_FRAMES_VERSION,
    status: "inconclusive",
    inconclusiveReason: reason,
    keyFrames: allInconclusive(reason),
    handedness,
    handednessCheck: "not_checkable",
    diagnostics,
  });

  if (n < 2 || !fps || t[n - 1] - t[0] < KF_MIN_CLIP_SECONDS) return fail("too_short");

  // --- body scale and centre -------------------------------------------
  const torsoLengths = frames.map(torsoLengthOf).filter((v): v is number => v !== null);
  const scale = median(torsoLengths);
  // A frame with an upside-down torso (a one-frame pose flip) has no usable centre either.
  const centres = frames.map((f) => {
    const c = hipCentre(f);
    return c && torsoUpright(f, c) ? c : null;
  });
  const centreCount = centres.filter((c) => c !== null).length;
  // Need a scale from several frames and a body centre in at least half of them.
  if (scale === null || torsoLengths.length < 3 || centreCount < n / 2) return fail("partial_body");
  diagnostics.torsoLength = round3(scale);

  // --- hand track, relative to the body centre, in torso lengths, up = +y --
  const raw: (Point | null)[] = new Array(n).fill(null);
  const conf: number[] = new Array(n).fill(0);
  const observed: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const c = centres[i];
    const h = handPoint(frames[i], scale, handedness);
    if (!c || !h) continue;
    raw[i] = { x: (h.p.x - c.x) / scale, y: (c.y - h.p.y) / scale };
    conf[i] = h.conf;
    observed[i] = true;
  }
  const observedCount = observed.filter(Boolean).length;
  diagnostics.handCoverage = round3(observedCount / n);

  // Bridge short gaps (downswing blur) by linear interpolation.
  const filled = raw.slice();
  let interpolated = 0;
  for (let i = 0; i < n; ) {
    if (filled[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && filled[j] === null) j++;
    const a = i - 1;
    const b = j;
    if (a >= 0 && b < n && t[b] - t[a] <= KF_MAX_GAP_SECONDS + 1e-9) {
      const pa = filled[a] as Point;
      const pb = filled[b] as Point;
      for (let k = i; k < j; k++) {
        const u = (t[k] - t[a]) / (t[b] - t[a]);
        filled[k] = { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u };
        interpolated++;
      }
    }
    i = j;
  }
  diagnostics.interpolatedFrames = interpolated;

  // Running median (each axis), needing a majority of the window present.
  const half = (w - 1) / 2;
  const s: (Point | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      const p = filled[k];
      if (p) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    if (filled[i] && xs.length > half) s[i] = { x: median(xs) as number, y: median(ys) as number };
  }

  // Velocities over a multi-frame baseline.
  const kb = framesFor(KF_SPEED_BASELINE_SECONDS, fps, 1);
  const diff = (i: number, j: number): { vx: number; vy: number } | null => {
    if (i < 0 || j >= n || i >= j) return null;
    const a = s[i];
    const b = s[j];
    const dt = t[j] - t[i];
    if (!a || !b || !(dt > 0)) return null;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  };
  const vyCentred: (number | null)[] = frames.map((_, i) => diff(i - kb, i + kb)?.vy ?? null);
  const speedOf = (v: { vx: number; vy: number } | null): number | null => (v ? Math.hypot(v.vx, v.vy) : null);
  // Backward speed: still at i means i and the frames before it are still (address = last still frame).
  const speedBack: (number | null)[] = frames.map((_, i) => speedOf(diff(i - 2 * kb, i)));
  // Forward speed: still at i means i and the frames after it are still (finish = first held frame).
  const speedFwd: (number | null)[] = frames.map((_, i) => speedOf(diff(i, i + 2 * kb)));

  const y = (i: number): number | null => s[i]?.y ?? null;
  const idxAtOrAfter = (time: number): number => {
    let i = 0;
    while (i < n && t[i] < time - 1e-9) i++;
    return i;
  };
  const idxAtOrBefore = (time: number): number => {
    let i = n - 1;
    while (i >= 0 && t[i] > time + 1e-9) i--;
    return i;
  };
  const argBest = (from: number, to: number, better: (a: number, b: number) => boolean): number | null => {
    let best: number | null = null;
    for (let i = Math.max(0, from); i <= Math.min(n - 1, to); i++) {
      const v = y(i);
      if (v === null) continue;
      if (best === null || better(v, y(best) as number)) best = i;
    }
    return best;
  };

  // --- swing candidates: fastest downward hand motion, its top and bottom --
  const candidates: { d: number; top: number; impact: number; drop: number; speed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = vyCentred[i];
    if (v === null || v > -KF_MIN_DOWNSWING_SPEED) continue;
    let isMin = true;
    for (let k = Math.max(0, i - kb); k <= Math.min(n - 1, i + kb); k++) {
      const u = vyCentred[k];
      if (k !== i && u !== null && (u < v || (u === v && k < i))) isMin = false;
    }
    if (!isMin) continue;
    const top = argBest(idxAtOrAfter(t[i] - KF_MAX_DOWNSWING_SECONDS), i, (a, b) => a > b);
    const impact = argBest(i, idxAtOrBefore(t[i] + KF_MAX_IMPACT_SEARCH_SECONDS), (a, b) => a < b);
    if (top === null || impact === null || top >= impact) continue;
    const drop = (y(top) as number) - (y(impact) as number);
    if (drop < KF_MIN_HAND_RISE) continue;
    if (candidates.some((c) => c.top === top && c.impact === impact)) continue;
    candidates.push({ d: i, top, impact, drop, speed: -v });
  }
  candidates.sort((a, b) => b.drop - a.drop || b.speed - a.speed);
  diagnostics.swingCandidates = candidates.map((c) => ({
    topFrameIndex: frames[c.top].frameIndex,
    impactFrameIndex: frames[c.impact].frameIndex,
    drop: round3(c.drop),
    peakDownSpeed: round3(c.speed),
  }));

  if (candidates.length === 0) return fail(observedCount < n / 2 ? "wrists_not_tracked" : "no_swing_motion");
  const best = candidates[0];
  const separation = KF_MAX_DOWNSWING_SECONDS + KF_MAX_IMPACT_SEARCH_SECONDS;
  const rival = candidates.find(
    (c) =>
      c !== best &&
      Math.abs(t[c.impact] - t[best.impact]) > separation &&
      c.drop >= KF_MULTI_SWING_RATIO * best.drop &&
      c.speed >= KF_MULTI_SWING_RATIO * best.speed,
  );
  if (rival) return fail("multiple_swings");

  const topI = best.top;
  const impactI = best.impact;
  const topY = y(topI) as number;
  const impactY = y(impactI) as number;
  const highEnough = (i: number, ref: number): boolean => (y(i) ?? -Infinity) >= ref + KF_MIN_HAND_RISE / 2;
  const lowEnough = (i: number): boolean => (y(i) ?? Infinity) <= topY - KF_MIN_HAND_RISE / 2;

  // --- address: last still, low-hands frame before the top ---------------
  const stillFrames = framesFor(KF_MIN_STILL_SECONDS, fps, 2);
  const addrFrom = idxAtOrAfter(t[topI] - KF_MAX_ADDRESS_SEARCH_SECONDS);
  let addressI: number | null = null;
  let addressStill = 0;
  for (let i = topI - 1; i >= addrFrom && addressI === null; i--) {
    let run = 0;
    for (let k = i; k >= addrFrom; k--) {
      const sp = speedBack[k];
      if (sp === null || sp > KF_STILL_MAX_SPEED || !lowEnough(k)) break;
      run++;
    }
    if (run >= stillFrames) {
      addressI = i;
      addressStill = run;
    }
  }
  let addressReason: KeyFrameReason | null = null;
  if (addressI === null) {
    // Reached the clip start while the hands were already moving or high: the takeaway predates the clip.
    const reachedStart = addrFrom === 0;
    addressReason = reachedStart ? "not_in_clip" : "no_still_address";
  }

  // --- finish: first held high-hands frame after impact, else follow-through peak --
  const finTo = idxAtOrBefore(t[impactI] + KF_MAX_FINISH_SEARCH_SECONDS);
  let finishI: number | null = null;
  let held = false;
  for (let i = impactI + 1; i <= finTo && finishI === null; i++) {
    if (!highEnough(i, impactY)) continue;
    let run = 0;
    for (let k = i; k <= finTo; k++) {
      const sp = speedFwd[k];
      if (sp === null || sp > KF_STILL_MAX_SPEED || !highEnough(k, impactY)) break;
      run++;
    }
    if (run >= stillFrames) {
      finishI = i;
      held = true;
    }
  }
  let finishReason: KeyFrameReason | null = null;
  if (finishI === null) {
    const peak = argBest(impactI + 1, finTo, (a, b) => a > b);
    if (peak === null || !highEnough(peak, impactY)) {
      finishReason = finTo >= n - 1 ? "not_in_clip" : "no_follow_through";
    } else {
      // Hands still rising when the observed track ends: the follow-through isn't finished in the clip.
      let lastObserved = n - 1;
      while (lastObserved > 0 && s[lastObserved] === null) lastObserved--;
      if (peak >= lastObserved - kb) finishReason = "not_in_clip";
      else finishI = peak;
    }
  }

  // --- whole-swing checks: other people, tracking jumps ------------------
  const swingFrom = addressI ?? idxAtOrAfter(t[topI] - 0.5);
  const swingTo = finishI ?? idxAtOrBefore(t[impactI] + 0.5);
  const multi = new Set(options.multiPersonFrameIndices ?? []);
  let multiCount = 0;
  let maxJump = 0;
  let prev: Point | null = null;
  for (let i = swingFrom; i <= swingTo; i++) {
    if (multi.has(frames[i].frameIndex)) multiCount++;
    const c = centres[i];
    if (c && prev) maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.y - prev.y) / scale);
    if (c) prev = c;
  }
  diagnostics.multiPersonFramesInSwing = multiCount;
  diagnostics.maxBodyJump = round3(maxJump);
  if (multiCount / (swingTo - swingFrom + 1) > KF_MAX_MULTI_PERSON_RATIO) return fail("multiple_people");
  if (maxJump > KF_MAX_BODY_JUMP) return fail("tracking_jump");

  // --- handedness direction check (face-on only) --------------------------
  let handednessCheck: HandednessCheck = "not_checkable";
  if (handedness && options.cameraAngle === "face_on" && addressI !== null) {
    const f = frames[addressI];
    const lead = confident(f, handedness === "right" ? "left_shoulder" : "right_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
    const trail = confident(f, handedness === "right" ? "right_shoulder" : "left_shoulder", QG_MIN_KEYPOINT_CONFIDENCE);
    const dx = (s[topI] as Point).x - (s[addressI] as Point).x;
    if (lead && trail && Math.abs(dx) >= 0.3) {
      handednessCheck = Math.sign(dx) === Math.sign(trail.x - lead.x) ? "consistent" : "contradicts";
    }
  }
  const handFactor = handednessCheck === "contradicts" ? 0.5 : 1;

  // --- local evidence and confidence --------------------------------------
  const lw = framesFor(KF_LOCAL_WINDOW_SECONDS, fps, 1);
  const local = (i: number): { coverage: number; meanConf: number } => {
    let total = 0;
    let obs = 0;
    let confSum = 0;
    for (let k = Math.max(0, i - lw); k <= Math.min(n - 1, i + lw); k++) {
      total++;
      if (observed[k]) {
        obs++;
        confSum += conf[k];
      }
    }
    return { coverage: obs / total, meanConf: obs ? confSum / obs : 0 };
  };
  const detected = (i: number, strength: number, extra: { held?: boolean } = {}): KeyFrameDetection => {
    const ev = local(i);
    if (ev.coverage < KF_MIN_LOCAL_COVERAGE) return inconclusive("wrists_not_tracked_at_phase");
    const c = round3(Math.max(0, Math.min(1, ev.coverage * ev.meanConf * Math.min(1, strength) * handFactor)));
    return {
      status: "detected",
      frameIndex: frames[i].frameIndex,
      timestampSeconds: t[i],
      confidence: c,
      confidenceLabel: label(c),
      localCoverage: round3(ev.coverage),
      ...extra,
    };
  };

  // An extremum at the edge of an unbridged gap is not a real turning point:
  // the true top or bottom may lie inside the gap. Never report it.
  const interior = (i: number): boolean => i > 0 && i < n - 1 && s[i - 1] !== null && s[i + 1] !== null;

  const rise = addressI !== null ? topY - (y(addressI) as number) : best.drop;
  const keyFrames: Record<KeyFrameName, KeyFrameDetection> = {
    address: addressI !== null ? detected(addressI, addressStill / (2 * stillFrames)) : inconclusive(addressReason as KeyFrameReason),
    top: interior(topI) ? detected(topI, rise / (2 * KF_MIN_HAND_RISE)) : inconclusive("wrists_not_tracked_at_phase"),
    impact:
      fps < KF_MIN_IMPACT_FPS
        ? inconclusive("frame_rate_too_low")
        : interior(impactI)
          ? detected(impactI, best.drop / (2 * KF_MIN_HAND_RISE))
          : inconclusive("wrists_not_tracked_at_phase"),
    finish: finishI !== null ? detected(finishI, held ? 1 : 0.5, { held }) : inconclusive(finishReason as KeyFrameReason),
  };
  const indexOf: Record<KeyFrameName, number | null> = { address: addressI, top: topI, impact: impactI, finish: finishI };
  for (const name of KEY_FRAME_NAMES) {
    const i = indexOf[name];
    if (keyFrames[name].status === "detected" && i !== null) diagnostics.handHeight[name] = round3(y(i) as number);
  }
  const nDetected = KEY_FRAME_NAMES.filter((k) => keyFrames[k].status === "detected").length;
  return {
    moduleVersion: KEY_FRAMES_VERSION,
    status: nDetected === 4 ? "detected" : nDetected === 0 ? "inconclusive" : "partial",
    inconclusiveReason: null,
    keyFrames,
    handedness,
    handednessCheck,
    diagnostics,
  };
}

/**
 * The detected key frames as SwingSegments, so phaseOrder.ts can check them.
 * Impact becomes a window of one analysis frame either side (pose-only data
 * can't pin contact). Backswing and downswing stay null (not detected).
 */
export function keyFramesToSwingSegments(result: KeyFrameResult, sequence: PoseSequence): SwingSegments {
  const moment = (d: KeyFrameDetection) =>
    d.status === "detected" ? { timestampSeconds: d.timestampSeconds, confidence: d.confidenceLabel } : null;
  const imp = result.keyFrames.impact;
  let impact: SwingSegments["impact"] = null;
  if (imp.status === "detected") {
    const i = sequence.frames.findIndex((f) => f.frameIndex === imp.frameIndex);
    const start = sequence.frames[Math.max(0, i - 1)].timestampSeconds;
    const end = sequence.frames[Math.min(sequence.frames.length - 1, i + 1)].timestampSeconds;
    impact = { windowStartSeconds: start, windowEndSeconds: end, confidence: imp.confidenceLabel };
  }
  return {
    address: moment(result.keyFrames.address),
    backswing: null,
    top: moment(result.keyFrames.top),
    downswing: null,
    impact,
    followThrough: moment(result.keyFrames.finish),
  };
}
