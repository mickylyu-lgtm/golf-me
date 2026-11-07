// Which round_messages rows the app holds (context/RealRoundsContext.tsx).
//
// The old load was one oldest-first, unlimited query over every round the
// caller can see (RLS scopes it). PostgREST caps a response at its max-rows
// setting (the live value isn't known here), so past that cap such a query
// returns the OLDEST slice and silently drops the newest messages.
//
// Now, like DMs (RealSocialContext MESSAGE_WINDOW):
//   - the global load is the newest ROUND_MESSAGE_WINDOW rows, newest first
//     with `id` as the tie-breaker, shown chronologically. Past the window
//     it's the oldest history that's left out, never the newest;
//   - a round chat that's open also loads its own newest ROUND_MESSAGE_PAGE
//     rows (keyset-ordered the same way), so a quiet round can't be pushed
//     out of the shared window by busier ones;
//   - rows are merged by id and sorted by (created_at, id), so the same row
//     from two fetches is held once and equal timestamps have one order.
// Older pages use a keyset cursor (created_at, id) rather than an offset, so
// rows inserted between page requests can't shift a page and cause a skip
// or a duplicate. There is no "load older" UI yet (DMs have none either):
// roundMessagesBefore is the building block for it.

export const ROUND_MESSAGE_WINDOW = 1000;
export const ROUND_MESSAGE_PAGE = 200;

export interface RoundMessageKey {
  id: string;
  round_id: string;
  created_at: string;
}

/** Where an older page starts: strictly before this row in (created_at, id) order. */
export interface RoundMessageCursor {
  createdAt: string;
  id: string;
}

// created_at as PostgREST returns timestamptz: ISO 8601 in UTC with
// "+00:00" and up to microseconds (trailing zeros dropped). Those strings
// order correctly as plain strings ("…:00+00:00" < "…:00.1+00:00" <
// "…:00.12+00:00"), and Date would drop the microseconds, so compare text.
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Chronological order with a stable tie-breaker: created_at, then id. */
export function compareRoundMessages(a: RoundMessageKey, b: RoundMessageKey): number {
  return cmp(a.created_at, b.created_at) || cmp(a.id, b.id);
}

/** Whether a row comes strictly before the cursor (what an older page returns). */
export function isBeforeCursor(row: RoundMessageKey, cursor: RoundMessageCursor): boolean {
  return compareRoundMessages(row, { id: cursor.id, round_id: row.round_id, created_at: cursor.createdAt }) < 0;
}

/** The cursor for the page before these rows: their oldest. Null for none. */
export function olderPageCursor(rows: readonly RoundMessageKey[]): RoundMessageCursor | null {
  let oldest: RoundMessageKey | null = null;
  for (const r of rows) if (!oldest || compareRoundMessages(r, oldest) < 0) oldest = r;
  return oldest ? { createdAt: oldest.created_at, id: oldest.id } : null;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The PostgREST `or` filter for rows strictly before the cursor, i.e.
 * created_at < c OR (created_at = c AND id < i), the same as isBeforeCursor.
 * Values are quoted (timestamps contain ':' '.' '+').
 */
export function roundMessagesBefore(cursor: RoundMessageCursor): string {
  const c = quote(cursor.createdAt);
  return `created_at.lt.${c},and(created_at.eq.${c},id.lt.${quote(cursor.id)})`;
}

/**
 * Every held row once (by id), chronologically. Earlier sources win a
 * conflict, so pass the freshest first. Rows of other rounds in a round's
 * page are ignored (a page is keyed by its round).
 */
export function mergeRoundMessageRows<T extends RoundMessageKey>(sources: readonly (readonly T[])[]): T[] {
  const byId = new Map<string, T>();
  for (const rows of sources) for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort(compareRoundMessages);
}

/**
 * Whether a chat's loaded history may be missing older messages, so the
 * thread says so instead of looking complete ("Showing the latest N").
 * With the query's exact total (PostgREST `count: "exact"`, independent of
 * any row cap): fewer held than exist. Without it: the response filled the
 * requested limit, so more may exist. A response the server cut below the
 * limit can only be told apart with the total.
 */
export function isHistoryCut(s: { held: number; total?: number | null; fetched: number; limit: number }): boolean {
  if (typeof s.total === "number" && Number.isFinite(s.total)) return s.held < s.total;
  return s.fetched >= s.limit;
}

/** A round's own page: only that round's rows. */
export function roundPageRows<T extends RoundMessageKey>(roundId: string, rows: readonly T[]): T[] {
  return rows.filter((r) => r.round_id === roundId);
}

/**
 * What RealRoundsContext composes messageRows from: the newest-N window and
 * the newest page of each open (watched) round chat. A page response is
 * kept only if it's the latest request for that round and the round is
 * still open; closing a round drops its page. Pages are keyed by round and
 * hold only that round's rows.
 */
export function createRoundMessageStore<T extends RoundMessageKey>() {
  let windowRows: T[] = [];
  const pages = new Map<string, T[]>();
  // Per open round: how many rows its page request returned, and the
  // round's exact total when the server gave one.
  const pageInfo = new Map<string, { fetched: number; total: number | null }>();
  const watchers = new Map<string, number>();
  const seqs = new Map<string, number>();
  const bump = (roundId: string) => {
    const next = (seqs.get(roundId) ?? 0) + 1;
    seqs.set(roundId, next);
    return next;
  };

  return {
    /** Every held row once, chronologically (the window wins a conflict: it's refreshed first). */
    rows(): T[] {
      return mergeRoundMessageRows([windowRows, ...pages.values()]);
    },
    setWindow(rows: readonly T[]) {
      windowRows = mergeRoundMessageRows([rows]);
    },
    /** A round chat opened. `first`: nobody had it open, load its page. */
    watch(roundId: string): { first: boolean; unwatch: () => boolean } {
      const count = (watchers.get(roundId) ?? 0) + 1;
      watchers.set(roundId, count);
      let active = true;
      return {
        first: count === 1,
        /** True when held rows changed (its page was dropped). */
        unwatch: () => {
          if (!active) return false;
          active = false;
          const left = (watchers.get(roundId) ?? 1) - 1;
          if (left > 0) {
            watchers.set(roundId, left);
            return false;
          }
          watchers.delete(roundId);
          bump(roundId); // an in-flight page for it is now stale
          pageInfo.delete(roundId);
          return pages.delete(roundId);
        },
      };
    },
    watched(): string[] {
      return [...watchers.keys()];
    },
    /** A page request for this round starts; pass the token to acceptPage. */
    beginPage(roundId: string): number {
      return bump(roundId);
    },
    /** Keeps a page response if it's still wanted. False = stale, dropped. */
    acceptPage(roundId: string, token: number, rows: readonly T[], total: number | null = null): boolean {
      if (seqs.get(roundId) !== token || !watchers.has(roundId)) return false;
      const own = roundPageRows(roundId, rows);
      pages.set(roundId, own);
      pageInfo.set(roundId, { fetched: own.length, total: typeof total === "number" ? total : null });
      return true;
    },
    /**
     * An open round's held history is cut (isHistoryCut against its page:
     * held = every held row of the round, window and page together). False
     * until its page has loaded: the shared window alone can't tell.
     */
    historyCut(roundId: string): { cut: boolean; held: number } {
      let held = 0;
      const seen = new Set<string>();
      for (const rows of [windowRows, pages.get(roundId) ?? []]) {
        for (const r of rows) {
          if (r.round_id !== roundId || seen.has(r.id)) continue;
          seen.add(r.id);
          held++;
        }
      }
      const info = pageInfo.get(roundId);
      return { cut: info ? isHistoryCut({ held, total: info.total, fetched: info.fetched, limit: ROUND_MESSAGE_PAGE }) : false, held };
    },
    /** The same change in every source (an unsend wiping a row locally). */
    patch(map: (rows: T[]) => T[]) {
      windowRows = map(windowRows);
      for (const [roundId, rows] of pages) pages.set(roundId, map(rows));
    },
    /** Another account: no rows carry over; open chats stay watched (the next load refills them), in-flight pages go stale. */
    reset() {
      windowRows = [];
      pages.clear();
      pageInfo.clear();
      for (const roundId of [...seqs.keys()]) bump(roundId);
    },
  };
}
