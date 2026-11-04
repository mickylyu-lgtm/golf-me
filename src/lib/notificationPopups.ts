// Which notifications are new enough to pop up as an in-app banner. No React
// imports, so tests/notificationPopups.test.ts runs under plain node.
//
// Read state lives on the server per account, so signing in on another
// device already shows the bell as read; what used to replay was the popup
// host, which only remembered "already seen" ids in memory and took that
// baseline on a 1.2 s timer. A slow first load (a fresh device) landed after
// the timer, so the whole history popped, read rows included (Micky,
// 2026-11-04). A popup now also has to be unread and created during this
// app session, which doesn't depend on network speed.

// Tolerance for the device clock running ahead of the server's.
export const POPUP_CLOCK_SLACK_MS = 60_000;

export function isFreshForPopup(n: { read: boolean; createdAt: string }, sessionStartMs: number): boolean {
  if (n.read) return false;
  const created = Date.parse(n.createdAt);
  if (Number.isNaN(created)) return false;
  return created >= sessionStartMs - POPUP_CLOCK_SLACK_MS;
}
