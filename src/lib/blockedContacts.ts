// Settings -> Safety -> Blocked golfers. Pure rules, no React or Supabase
// imports, so tests/blockedContacts.test.ts can run them under node --test.
//
// The list is the caller's OWN block rows, always: a row never depends on
// whether a profile for that golfer can be resolved. Since the server
// directory (20261106120000) every profile lookup drops anyone blocked
// either way, so on a cold reload nothing could name a blocked contact and
// the old list (blockedIds -> getGolfer -> filter(Boolean)) silently lost the
// row and its Unblock button while the block stayed in force.

export interface BlockedContact<G> {
  /** The blocked golfer's id: the key of the block row, used by Unblock. Never shown. */
  id: string;
  /** Name/avatar when it may be shown, otherwise null (the "Blocked contact" fallback). */
  golfer: G | null;
}

/**
 * One row per id the caller blocked, in the given order, deduped.
 * - named: the caller blocked them and they have NOT blocked the caller
 *   back (the same rule as my_blocked_profiles()); the first lookup that
 *   knows them wins (server blocked-names first, then anything cached);
 * - otherwise (no profile anywhere, deleted, unavailable, or a mutual
 *   block): golfer null, still listed, still unblockable.
 */
export function blockedContactRows<G>(
  blockedIds: readonly string[],
  blockedByIds: ReadonlySet<string>,
  lookups: ReadonlyArray<(id: string) => G | undefined>,
): BlockedContact<G>[] {
  const seen = new Set<string>();
  const rows: BlockedContact<G>[] = [];
  for (const id of blockedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let golfer: G | null = null;
    if (!blockedByIds.has(id)) {
      for (const lookup of lookups) {
        const found = lookup(id);
        if (found !== undefined) {
          golfer = found;
          break;
        }
      }
    }
    rows.push({ id, golfer });
  }
  return rows;
}

/** Unblock buttons in flight (disabled, so a second tap can't race the first). */
export function withPending(pending: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(pending);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export type UnblockOutcome = "unblocked" | "failed";

/**
 * Runs an unblock and always clears the pending flag. On failure the row
 * stays (the block row is still there, so blockedIds still lists it) and
 * the button works again: the caller retries. Never throws.
 */
export async function runUnblock(
  id: string,
  unblock: (id: string) => Promise<void>,
  setPending: (update: (prev: Set<string>) => Set<string>) => void,
): Promise<UnblockOutcome> {
  setPending((prev) => withPending(prev, id, true));
  try {
    await unblock(id);
    return "unblocked";
  } catch {
    return "failed";
  } finally {
    setPending((prev) => withPending(prev, id, false));
  }
}
