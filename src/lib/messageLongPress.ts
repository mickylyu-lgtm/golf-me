// Long-press on a DM bubble (touch / pen) opens its actions menu
// (reactions, Reply, Copy, Unsend).
// Pure rules, no React/DOM imports, so tests/unsend.test.ts runs them under
// plain node. The hook is lib/useMessageLongPress.ts.
//
// Coexistence with the thread's swipe gestures (useSwipeToReply: drag
// right; useSwipeToRevealTimes: drag left; native vertical scroll): the
// press is cancelled by the SAME movement that starts any of them, the
// shared AXIS_SLOP_PX. So a press that turns into a swipe or a scroll is
// never a long-press, and a long-press never moved far enough to be a swipe.

import { AXIS_SLOP_PX } from "./chatSwipe.ts";

// iOS's own long-press is ~500ms; a little shorter feels responsive
// without catching ordinary taps.
export const LONG_PRESS_MS = 450;

export function longPressCancelledByMove(dx: number, dy: number): boolean {
  return Math.abs(dx) >= AXIS_SLOP_PX || Math.abs(dy) >= AXIS_SLOP_PX;
}

// A pointercancel / touchcancel that arrives while the finger is still
// where it went down is NOT a scroll or a swipe taking over (those move
// past the slop first, and a real scroll also fires `scroll`, which always
// cancels). On iOS (WKWebView and Safari) it's typically WebKit's own
// long-press recogniser (text selection, link preview, callout) claiming
// the touch, i.e. the user IS holding: the press keeps running. Moved past
// the slop: a gesture took over, the press is cancelled.
export function longPressSurvivesCancel(dx: number, dy: number): boolean {
  return !longPressCancelledByMove(dx, dy);
}

// What the hold / right-click menu offers for one bubble, in display order.
// Reactions and Reply only where the thread allows them (not blocked,
// feature available); Copy always; Unsend only for my own message inside
// the window (lib/unsend.ts canUnsendMessage decides `canUnsend`).
export type MessageAction = "reply" | "copy" | "unsend";

// canCopy (default true) is false only for a photo with no text on a
// platform that can't put an image on the clipboard (lib/chatImageClient
// canCopyImages): there is then nothing Copy could do.
export function messageActions(input: { canReply: boolean; canUnsend: boolean; canCopy?: boolean }): MessageAction[] {
  const actions: MessageAction[] = [];
  if (input.canReply) actions.push("reply");
  if (input.canCopy !== false) actions.push("copy");
  if (input.canUnsend) actions.push("unsend");
  return actions;
}

// Where the menu goes: above the bubble when there's room, else below;
// clamped inside the viewport (with `gap` px margin) either way.
export function placeActionsMenu(input: {
  anchorTop: number;
  anchorBottom: number;
  menuHeight: number;
  viewportTop: number;
  viewportBottom: number;
  gap?: number;
}): { top: number; placement: "above" | "below" } {
  const gap = input.gap ?? 8;
  const above = input.anchorTop - gap - input.menuHeight;
  if (above >= input.viewportTop + gap) return { top: above, placement: "above" };
  const below = input.anchorBottom + gap;
  const maxTop = input.viewportBottom - gap - input.menuHeight;
  return { top: Math.max(input.viewportTop + gap, Math.min(below, maxTop)), placement: "below" };
}
