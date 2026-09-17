// Lightweight, reusable "reel-style" callout bubble — pinned near a body
// joint on the video itself (SEE the issue on the golfer), distinct from
// the longer explanation card below the video (READ Caddie's detailed
// take). Deliberately minimal: no annotation editor, no drag/resize, just
// a positioned label GolfMe itself places from already-computed data.
//
// Only ever rendered for a resolved "good"/"needs_improvement" segment —
// callers must never render this for "unknown"/limited-visibility data
// (there's nothing honest to say on-video about a joint that wasn't
// confidently assessed; that case stays silent here, same as the brief's
// own explicit rule).
export interface SwingCalloutProps {
  x: number; // anchor point, in the same pixel space as the parent's own positioning context (e.g. canvas/container-relative px)
  y: number;
  text: string;
  status: "good" | "needs_improvement";
  containerWidth: number;
  containerHeight: number;
}

const TONE = {
  good: { bg: "rgba(21, 128, 61, 0.92)", ring: "rgba(21, 128, 61, 0.5)" }, // fairway-700ish
  needs_improvement: { bg: "rgba(190, 24, 24, 0.92)", ring: "rgba(190, 24, 24, 0.5)" }, // red-700ish
};

const CALLOUT_OFFSET_Y = 14; // px above the anchor point
const CALLOUT_MARGIN = 8; // keeps the bubble from touching the video edge

export function SwingCallout({ x, y, text, status, containerWidth, containerHeight }: SwingCalloutProps) {
  const tone = TONE[status];
  // Clamp horizontally so a joint near either edge never pushes the bubble
  // (and its readable text) off the video — the ANCHOR dot itself still
  // sits exactly at the joint, only the label's own box shifts to stay
  // fully visible. Estimated half-width is generous on purpose (actual
  // text is short, per the brief's own "concise" requirement) rather than
  // measuring the real rendered box, which would need a layout pass before
  // the first paint.
  const estimatedHalfWidth = 90;
  const clampedCenterX = Math.min(Math.max(x, estimatedHalfWidth + CALLOUT_MARGIN), containerWidth - estimatedHalfWidth - CALLOUT_MARGIN);
  // Flips below the joint instead of above when there isn't room above —
  // the graceful "avoid covering the golfer/controls" fallback for a joint
  // near the top of the frame.
  const flipBelow = y < CALLOUT_OFFSET_Y + 40;
  const top = flipBelow ? y + CALLOUT_OFFSET_Y : y - CALLOUT_OFFSET_Y;
  const clampedTop = Math.min(Math.max(top, CALLOUT_MARGIN), containerHeight - CALLOUT_MARGIN);

  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 select-none"
      style={{ left: clampedCenterX, top: clampedTop, transform: `translate(-50%, ${flipBelow ? "0" : "-100%"})` }}
    >
      <span
        className="block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm"
        style={{ backgroundColor: tone.bg, boxShadow: `0 0 0 2px ${tone.ring}` }}
      >
        {text}
      </span>
    </div>
  );
}
