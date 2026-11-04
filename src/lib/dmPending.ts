// Optimistic (pending) DMs and their reconciliation with the real rows.
// No React imports, so tests/dmPending.test.ts runs under plain node.
//
// The bug this replaces ("pasting into a DM double-sends"): a pending
// bubble was only dropped when a fetched row matched it by conversation +
// sender + exact text AND `row.created_at >= pending.created_at`, compared
// as STRINGS. The pending time is the phone's clock, the row's is the
// server's now(). Whenever the phone's clock ran even slightly ahead of the
// server (more than the one-way latency of the insert), or both fell in the
// same millisecond ("...56.123456+00:00" sorts before "...56.123Z"), the
// match failed and the pending bubble stayed forever next to the real
// message: one insert, two bubbles, until the app was reloaded. Same shape
// as the round chat's old fix (lib/roundChat.ts): the insert now returns
// the row id, and a sent pending message is matched to its row BY ID. A
// content match is only the fallback for a sent message whose id didn't
// come back, with clock skew allowed for and every row claimed once.

export interface DmRowLike {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

export interface PendingDmLike {
  tempId: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  // Local clock, only for ordering on screen.
  created_at: string;
  // Set once the insert succeeded and returned its row.
  serverId?: string;
  // The insert succeeded (with or without a returned id).
  sent?: boolean;
}

// Clock skew tolerated when a sent message has to be matched by content.
export const DM_MATCH_SKEW_MS = 2 * 60 * 1000;

function contentMatches(p: PendingDmLike, row: DmRowLike): boolean {
  if (row.conversation_id !== p.conversation_id || row.sender_id !== p.sender_id || row.text !== p.text) return false;
  const rowMs = Date.parse(row.created_at);
  const pendingMs = Date.parse(p.created_at);
  if (!Number.isFinite(rowMs) || !Number.isFinite(pendingMs)) return false;
  return rowMs >= pendingMs - DM_MATCH_SKEW_MS;
}

// The pending messages still to show: those whose real row isn't in `rows`
// yet. In flight (not yet sent): always kept, so a refetch racing the
// insert can't make the bubble blink out; at worst the real row and the
// pending one overlap until the insert returns its id a moment later.
// Returns the same array when nothing is dropped.
export function reconcilePendingDms<P extends PendingDmLike>(pending: readonly P[], rows: readonly DmRowLike[]): P[] {
  if (pending.length === 0) return pending as P[];
  const claimed = new Set<string>();
  // Ids first: those rows are spoken for and never feed a content match.
  for (const p of pending) if (p.serverId) claimed.add(p.serverId);
  const rowIds = new Set(rows.map((r) => r.id));
  const next = pending.filter((p) => {
    if (p.serverId) return !rowIds.has(p.serverId);
    if (!p.sent) return true;
    const row = rows.find((r) => !claimed.has(r.id) && contentMatches(p, r));
    if (!row) return true;
    claimed.add(row.id);
    return false;
  });
  return next.length === pending.length ? (pending as P[]) : next;
}
