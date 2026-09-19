// Lightweight, reusable "reel-style" callout bubble — docked to a rail near
// the left/right edge of the video (SEE the issue on the golfer, without
// the label sitting on top of them), with a thin leader line drawn
// separately on the canvas overlay connecting the label back to the real
// joint. Distinct from the longer explanation card below the video (READ
// Caddie's detailed take). Deliberately minimal: no annotation editor, no
// drag/resize, just a positioned label GolfMe itself places from
// already-computed data.
//
// Only ever rendered for a resolved "good"/"needs_improvement" segment —
// callers must never render this for "unknown"/limited-visibility data
// (there's nothing honest to say on-video about a joint that wasn't
// confidently assessed; that case stays silent here, same as the brief's
// own explicit rule).
export interface SwingCalloutProps {
  x: number; // dock point (near the left/right rail), same pixel space as the parent's canvas/container positioning
  y: number; // dock point, vertically near the joint it points to
  side: "left" | "right"; // which rail this label is docked to — determines which direction the label grows away from its edge
  text: string;
  status: "good" | "needs_improvement";
  containerWidth: number;
  containerHeight: number;
}

const TONE = {
  good: { bg: "rgba(21, 128, 61, 0.92)", ring: "rgba(21, 128, 61, 0.5)" }, // fairway-700ish
  needs_improvement: { bg: "rgba(190, 24, 24, 0.92)", ring: "rgba(190, 24, 24, 0.5)" }, // red-700ish
};

const CALLOUT_MARGIN = 8; // keeps the bubble from touching the video edge

export function SwingCallout({ x, y, side, text, status, containerWidth, containerHeight }: SwingCalloutProps) {
  const tone = TONE[status];
  // The caller already computed a rail-appropriate dock point (see
  // CaddieSwingReplay's draw()) — this is just a defensive final clamp so a
  // container resize between render passes can never push the label fully
  // off-screen. side determines which CSS edge anchors the label: a
  // left-rail label grows rightward (toward the golfer) from `left`, a
  // right-rail label grows leftward from `right` — neither needs a
  // translateX/estimated-width hack the way a center-anchored label would.
  const clampedY = Math.min(Math.max(y, CALLOUT_MARGIN), containerHeight - CALLOUT_MARGIN);
  const clampedX = side === "left" ? Math.max(x, CALLOUT_MARGIN) : Math.min(x, containerWidth - CALLOUT_MARGIN);

  return (
    <div
      className="pointer-events-none absolute z-10 -translate-y-1/2 select-none"
      style={side === "left" ? { left: clampedX, top: clampedY } : { right: containerWidth - clampedX, top: clampedY }}
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
