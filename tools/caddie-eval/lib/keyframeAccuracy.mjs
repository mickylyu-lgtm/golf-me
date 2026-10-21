// Key-frame identification accuracy: predicted key frames vs K00's labeled
// key frames (PROTOTYPE labels). The local prototype has NO key-frame
// detector yet (PROTOTYPE_CAPABILITIES.swing_phases = "not implemented"), so
// the report states "not implemented" and never calls this on real data.
// The scorer exists so a future detector is measured the same way, and is
// tested on synthetic data only.
//
// Definitions (EVAL_REPORT_TEMPLATE.md §4a):
// - unit: one key frame (address, top, impact, finish) on one clip that K00
//   labeled with status "labeled"; "not_in_clip" and "cant_tell" are excluded
//   and counted;
// - error = |predicted frame - labeled frame|, in frames and in ms
//   (frames / analysis fps x 1000), on the shared export/pose timeline;
// - within tolerance = error <= 67 ms (the template's phase tolerance: 2
//   frames at 30 fps, 4 at 60 fps); also reported: within 1 frame;
// - a missing prediction for a labeled key frame counts as a miss (not
//   within tolerance), never dropped.
import { KEYFRAME_EVENTS } from "./annotations.mjs";

export const KEYFRAME_TOLERANCE_MS = 67;

/** predicted: { events: { address: { frame_index } | null, ... } }; truth: a K00 annotation version. */
export function scoreKeyframePredictions(predicted, truth, { toleranceMs = KEYFRAME_TOLERANCE_MS } = {}) {
  const fps = truth.frame_source.analysis_fps;
  const byEvent = {};
  for (const ev of KEYFRAME_EVENTS) {
    const t = truth.keyframes[ev];
    const row = { labeled: 0, excluded: 0, predicted: 0, missing: 0, withinTolerance: 0, withinOneFrame: 0, errorsMs: [], errorsFrames: [] };
    if (!t || t.status !== "labeled") row.excluded = 1;
    else {
      row.labeled = 1;
      const p = predicted?.events?.[ev];
      if (!p || !Number.isInteger(p.frame_index)) row.missing = 1;
      else {
        row.predicted = 1;
        const frames = Math.abs(p.frame_index - t.frame_index);
        const ms = (frames / fps) * 1000;
        row.errorsFrames.push(frames);
        row.errorsMs.push(Math.round(ms * 10) / 10);
        if (ms <= toleranceMs + 1e-9) row.withinTolerance = 1;
        if (frames <= 1) row.withinOneFrame = 1;
      }
    }
    byEvent[ev] = row;
  }
  return { toleranceMs, analysisFps: fps, byEvent };
}
