// The photo/video slots of a Community post being composed (CreatePost).
//
// Uploads are slow and a golfer can pick more while earlier ones are still
// running (the Photo pill stays live, and the native picker hands files over
// before they upload). Two things went wrong when that was tracked with a
// single `uploading` boolean and a cap check against `mediaItems.length`:
// - the first batch to finish cleared the flag while another still ran, so
//   Post enabled before every item was in, and a publish then went out
//   without them;
// - the cap check only counted items already in React state, so picks made
//   while uploads ran (or several before a render) each saw the full 10 free
//   and a post could collect more than 10.
//
// The ledger is plain, synchronous bookkeeping the page consults at every
// action boundary, before any await: a pick reserves slots up front (accepted
// + reserved never passes the cap), each upload ends its slot exactly once
// (commit or release), and a slot cancelled by Remove / Replace / leaving the
// page can't come back when its upload finishes late. Publish asks it whether
// the snapshot it is about to send is complete.

export interface MediaSlot {
  /** Becomes the item's id once committed. */
  id: string;
  /** Pick order: items are shown and published in this order. */
  seq: number;
}

export type PublishBlock = "pending" | "over_cap" | "out_of_sync";

export interface PostMediaLedger {
  readonly cap: number;
  /** Slots still uploading. */
  readonly pending: number;
  /** Items in the post. */
  readonly accepted: number;
  /** Free slots: cap - accepted - pending (never below 0). */
  readonly remaining: number;
  /** Reserves up to `requested` slots (fewer when the cap is near; [] when full). */
  reserve(requested: number): MediaSlot[];
  /** Ends a slot's upload successfully. False when the slot was cancelled or already ended: drop the result. */
  commit(slot: MediaSlot): boolean;
  /** Ends a slot's upload without an item (failure, skipped). Idempotent. */
  release(slot: MediaSlot): void;
  /** Whether this slot's upload is still wanted. */
  isLive(slot: MediaSlot): boolean;
  /** Removes an item, or cancels a slot still uploading. */
  remove(id: string): void;
  /** Drops every item and cancels every pending slot (Replace, leaving the page). */
  clear(): void;
  /** Cancels every slot still uploading and keeps the items (leaving the page; safe under StrictMode's mount/unmount/mount). */
  cancelPending(): void;
  /** Pick order of an item (items restored from a draft come first, in their order). */
  seqOf(id: string): number;
  /** Why this list can't be published right now, or null if it can. */
  publishBlock(itemIds: readonly string[]): PublishBlock | null;
}

export function createPostMediaLedger(cap: number, initialIds: readonly string[] = [], newId: () => string = () => crypto.randomUUID()): PostMediaLedger {
  let seq = 0;
  const accepted = new Map<string, number>();
  const pending = new Map<string, number>();
  // A draft from an older build could hold more than the cap; it is kept as
  // is (nothing silently dropped) but no new slot opens and publish refuses.
  for (const id of initialIds) {
    if (!accepted.has(id)) accepted.set(id, seq++);
  }

  function live(slot: MediaSlot): boolean {
    return pending.get(slot.id) === slot.seq;
  }

  return {
    cap,
    get pending() {
      return pending.size;
    },
    get accepted() {
      return accepted.size;
    },
    get remaining() {
      return Math.max(0, cap - accepted.size - pending.size);
    },
    reserve(requested) {
      const n = Math.max(0, Math.min(Math.floor(Number.isFinite(requested) ? requested : 0), cap - accepted.size - pending.size));
      const slots: MediaSlot[] = [];
      for (let i = 0; i < n; i++) {
        const slot = { id: newId(), seq: seq++ };
        pending.set(slot.id, slot.seq);
        slots.push(slot);
      }
      return slots;
    },
    commit(slot) {
      if (!live(slot)) return false;
      pending.delete(slot.id);
      accepted.set(slot.id, slot.seq);
      return true;
    },
    release(slot) {
      if (live(slot)) pending.delete(slot.id);
    },
    isLive: live,
    remove(id) {
      accepted.delete(id);
      pending.delete(id);
    },
    clear() {
      accepted.clear();
      pending.clear();
    },
    cancelPending() {
      pending.clear();
    },
    seqOf(id) {
      return accepted.get(id) ?? pending.get(id) ?? Number.POSITIVE_INFINITY;
    },
    publishBlock(itemIds) {
      if (pending.size > 0) return "pending";
      if (itemIds.length > cap) return "over_cap";
      if (itemIds.length !== accepted.size || new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !accepted.has(id))) return "out_of_sync";
      return null;
    },
  };
}

/**
 * Uploads one picked batch into its reserved slots, one file at a time (a
 * mixed batch shows up progressively; one bad file is skipped, not the
 * batch). Every slot ends exactly once: committed with its item, or
 * released on failure. A slot cancelled meanwhile (Remove, Replace, leaving
 * the page) is never uploaded if it hasn't started, and its late result is
 * dropped if it has. `onChange` runs after every slot ends, so the page can
 * mirror `ledger.pending` into state.
 */
export async function uploadIntoSlots<F, T extends { id: string }>(opts: {
  ledger: PostMediaLedger;
  batch: readonly { file: F; slot: MediaSlot }[];
  upload: (file: F, slot: MediaSlot) => Promise<Omit<T, "id">>;
  onCommitted: (item: T) => void;
  onFailed: (file: F, err: unknown) => void;
  onChange: () => void;
}): Promise<void> {
  const { ledger, batch } = opts;
  for (const { file, slot } of batch) {
    if (!ledger.isLive(slot)) continue;
    try {
      const fields = await opts.upload(file, slot);
      if (ledger.commit(slot)) opts.onCommitted({ ...fields, id: slot.id } as T);
    } catch (err) {
      const wasLive = ledger.isLive(slot);
      ledger.release(slot);
      if (wasLive) opts.onFailed(file, err);
    } finally {
      // A throw from onCommitted must not leave the slot reserved.
      ledger.release(slot);
      opts.onChange();
    }
  }
}

/** Inserts `item` into `items` by pick order (`seqOf`), so a later pick finishing first doesn't jump ahead. */
export function insertBySeq<T extends { id: string }>(items: readonly T[], item: T, seqOf: (id: string) => number): T[] {
  if (items.some((m) => m.id === item.id)) return [...items];
  const s = seqOf(item.id);
  const at = items.findIndex((m) => seqOf(m.id) > s);
  if (at < 0) return [...items, item];
  return [...items.slice(0, at), item, ...items.slice(at)];
}
