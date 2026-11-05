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

// The messages that arrived after `lastSeenId` (the newest one already
// handled). Messages are oldest-first and new ones are appended, so this is
// everything after it. Unknown or missing id (first load, history cleared,
// a thread switch): nothing counts as newly arrived.
export function messagesAfter<T extends { id: string }>(messages: readonly T[], lastSeenId: string | null): T[] {
  if (lastSeenId === null) return [];
  const index = messages.findIndex((m) => m.id === lastSeenId);
  return index < 0 ? [] : messages.slice(index + 1);
}

// What a chat does when messages arrive (DM thread and round chat alike):
// - one of them is the golfer's own (a send, optimistic or confirmed, or a
//   "Not sent" bubble): always pin to the newest message, wherever they were
//   reading (Micky, 2026-11-05: "sending always brings me to the bottom").
//   Keyed on the bubble itself, not on a "just sent" flag, so a send whose
//   bubble only appears after a network round trip (real DMs) still pins.
// - otherwise near the bottom: pin, as before.
// - otherwise (reading older messages): leave the scroll alone and count
//   the incoming ones for the "New messages" pill.
export function followNewMessages({
  added,
  selfId,
  nearBottom,
}: {
  added: readonly { senderId: string; system?: boolean }[];
  selfId: string;
  nearBottom: boolean;
}): { pin: boolean; unseen: number } {
  if (added.length === 0) return { pin: false, unseen: 0 };
  if (added.some((m) => m.senderId === selfId) || nearBottom) return { pin: true, unseen: 0 };
  return { pin: false, unseen: added.filter((m) => !m.system).length };
}
