// Pure decision rules shared by the DM thread's two in-list horizontal
// gestures: swipe LEFT to reveal times (useSwipeToRevealTimes) and swipe
// RIGHT on a bubble to reply (useSwipeToReply). Both lock the gesture's
// direction once, from the first few pixels of movement, so they can never
// both act on the same drag. Free of DOM/React so `npm run test:chat`
// covers them with plain node.

// Movement below this, in both axes, doesn't decide anything yet.
export const AXIS_SLOP_PX = 8;
// Swipe-to-reply: released at or past this, the message becomes the reply
// target (and the haptic fires the moment the drag crosses it).
export const REPLY_THRESHOLD_PX = 60;
// Past the threshold the bubble keeps moving at a fraction of the finger,
// then stops.
const REPLY_OVERDRAG_RESISTANCE = 0.3;
export const REPLY_MAX_OVERDRAG_PX = 30;

export type SwipeDirection = "pending" | "left" | "right" | "vertical";

// "pending" until the finger has moved past the slop; then whichever axis
// moved more wins (a tie goes to vertical, so native scroll keeps priority).
export function lockDirection(dx: number, dy: number): SwipeDirection {
  if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return "pending";
  if (Math.abs(dx) <= Math.abs(dy)) return "vertical";
  return dx < 0 ? "left" : "right";
}

// How far the bubble moves for a rightward finger travel of dx. Never left
// of rest; 1:1 up to the threshold, then resisted and capped.
export function replyDragOffset(dx: number): number {
  if (dx <= 0) return 0;
  if (dx <= REPLY_THRESHOLD_PX) return dx;
  return REPLY_THRESHOLD_PX + Math.min(REPLY_MAX_OVERDRAG_PX, (dx - REPLY_THRESHOLD_PX) * REPLY_OVERDRAG_RESISTANCE);
}

export function replyProgress(offset: number): number {
  return Math.max(0, Math.min(1, offset / REPLY_THRESHOLD_PX));
}

export function isPastReplyThreshold(offset: number): boolean {
  return offset >= REPLY_THRESHOLD_PX;
}

// One haptic per crossing: fires when the drag goes from below to at/over
// the threshold, never while it stays past it. Dragging back under and over
// again fires again (the same as Messages/WhatsApp).
export function crossedReplyThreshold(previousOffset: number, offset: number): boolean {
  return !isPastReplyThreshold(previousOffset) && isPastReplyThreshold(offset);
}
