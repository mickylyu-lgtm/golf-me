// Pure decision rules for the DM thread's horizontal gestures (Micky,
// 2026-10-28, final: "it should be swipe right on message"):
//   - RIGHT, starting in the edge strip       -> back (useEdgeSwipeBack; wins)
//   - RIGHT, starting on a message bubble     -> reply (useSwipeToReply)
//   - RIGHT, anywhere else                    -> nothing
//   - LEFT, anywhere (on or off a bubble)     -> reveal times (useSwipeToRevealTimes)
//   - mostly vertical                     -> native scroll
// Each hook locks the direction once, from the first few pixels of
// movement, and acts only on its own class, so no two can ever act on the
// same drag. Free of DOM/React so `npm run test:chat` covers it with node.

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
export type SwipeAction = "pending" | "reply" | "times" | "back" | "scroll" | "none";

// "pending" until the finger has moved past the slop; then whichever axis
// moved more wins (a tie goes to vertical, so native scroll keeps priority).
export function lockDirection(dx: number, dy: number): SwipeDirection {
  if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return "pending";
  if (Math.abs(dx) <= Math.abs(dy)) return "vertical";
  return dx < 0 ? "left" : "right";
}

// What a locked gesture means, from where it started. `onBubble` is true
// only when the start was on a reply-enabled message bubble (the thread
// marks bubbles only while replying is possible), `inEdge` when it was in
// the edge-swipe-back strip (isEdgeStart).
export function classifySwipe(direction: SwipeDirection, start: { onBubble: boolean; inEdge: boolean }): SwipeAction {
  switch (direction) {
    case "pending":
      return "pending";
    case "vertical":
      return "scroll";
    case "left":
      return "times";
    case "right":
      if (start.inEdge) return "back";
      return start.onBubble ? "reply" : "none";
  }
}

// How far the bubble moves for a finger pull of `pull` px in the reply
// direction (a positive number: the rightward dx). Never past rest; 1:1 up to the threshold, then resisted and
// capped.
export function replyDragOffset(pull: number): number {
  if (pull <= 0) return 0;
  if (pull <= REPLY_THRESHOLD_PX) return pull;
  return REPLY_THRESHOLD_PX + Math.min(REPLY_MAX_OVERDRAG_PX, (pull - REPLY_THRESHOLD_PX) * REPLY_OVERDRAG_RESISTANCE);
}

export function replyProgress(offset: number): number {
  return Math.max(0, Math.min(1, offset / REPLY_THRESHOLD_PX));
}

export function isPastReplyThreshold(offset: number): boolean {
  return offset >= REPLY_THRESHOLD_PX;
}

// One haptic per crossing: fires when the drag goes from below to at/over
// the threshold, never while it stays past it. Dragging back under and over
// again fires again.
export function crossedReplyThreshold(previousOffset: number, offset: number): boolean {
  return !isPastReplyThreshold(previousOffset) && isPastReplyThreshold(offset);
}
