// Round chat's "follow the newest message" rule, the same one the DM
// thread uses (DirectMessageThread.tsx nearBottomRef): a new message only
// pins the list to the bottom if the reader was already there, or if it's
// the one they just sent. Someone reading older messages isn't yanked
// down. Pinning only ever sets the list's own scrollTop -- never
// scrollIntoView, which also scrolls the window (on the round page that
// dragged the whole page to the chat card on every message).
// No React imports, so tests/chatScroll.test.ts runs under plain node.

export const NEAR_BOTTOM_PX = 120;

interface ScrollBox {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function isNearBottom(el: ScrollBox): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

export function shouldPinToBottom({ nearBottom, justSent }: { nearBottom: boolean; justSent: boolean }): boolean {
  return nearBottom || justSent;
}

export function pinToBottom(el: { scrollHeight: number; scrollTop: number }): void {
  el.scrollTop = el.scrollHeight;
}
