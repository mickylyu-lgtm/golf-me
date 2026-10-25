// Pure decision rules for the iOS-style edge swipe back on the DM thread
// (useEdgeSwipeBack). Kept free of DOM/React so `npm run test:chat` can
// cover them with plain node.

// A gesture only counts as "back" when it starts this close to the left
// edge of the page column (iOS uses roughly the same strip).
export const EDGE_PX = 32;
// Movement below this, in both axes, doesn't decide anything yet.
export const DECIDE_SLOP_PX = 10;
// Released past this fraction of the width: go back.
export const COMPLETE_FRACTION = 0.35;
// A fast rightward fling completes even when short...
export const FLING_PX_PER_MS = 0.5;
// ...as long as it actually moved a little.
export const MIN_FLING_PX = 24;
// Moving back left this fast at release cancels, even past the threshold.
export const CANCEL_PX_PER_MS = -0.2;

export function isEdgeStart(xFromLeft: number): boolean {
  return xFromLeft >= 0 && xFromLeft <= EDGE_PX;
}

// "pending" until the finger moves past the slop; then "back" only for a
// rightward, mostly horizontal move. Anything else ("other") is left to
// the page's existing gestures (vertical scroll, swipe-left-for-times).
export function classifyMove(dx: number, dy: number): "pending" | "back" | "other" {
  if (Math.abs(dx) < DECIDE_SLOP_PX && Math.abs(dy) < DECIDE_SLOP_PX) return "pending";
  return dx > 0 && dx > Math.abs(dy) ? "back" : "other";
}

export function dragOffset(dx: number): number {
  return dx > 0 ? dx : 0;
}

export function shouldComplete(offset: number, width: number, velocityPxPerMs: number): boolean {
  if (velocityPxPerMs <= CANCEL_PX_PER_MS) return false;
  if (velocityPxPerMs >= FLING_PX_PER_MS && offset >= MIN_FLING_PX) return true;
  return width > 0 && offset >= width * COMPLETE_FRACTION;
}
