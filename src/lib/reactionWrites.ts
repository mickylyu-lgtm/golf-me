// Ordering for my reaction writes (hold a DM bubble -> emoji row; tap my
// pill to remove). Without it two quick taps send two requests at once and
// whichever finishes LAST wins on the server, so A-then-B could end as A,
// and add-then-remove could leave the reaction there.
//
// Per message (the user is fixed: one queue per signed-in account, reset on
// account switch):
//   * at most ONE write in flight;
//   * the latest wanted state queued behind it; a newer tap replaces the
//     queued one, which is then never sent (coalesced);
//   * nothing is sent when the wanted state is what the server already has
//     (no duplicate writes: add -> remove -> add while the add is in flight
//     is one write);
//   * after a failure, the queued newer state (if any) is still sent; with
//     nothing newer, the message settles on the last state the server
//     confirmed, i.e. a rollback only when no newer intent exists.
//   * each write is bounded (REACTION_WRITE_TIMEOUT_MS, aborted through the
//     signal). A timeout counts as a failure, but the server may still have
//     applied it, so what the server holds becomes UNKNOWN: the next queued
//     state is always sent (never skipped as "already there"), and when the
//     message settles after a timeout onSettled says `uncertain` so the
//     caller refetches instead of trusting the rollback. A success that
//     arrives after its timeout calls onLateSuccess (refetch again).
//
// Each set() resolves:
//   false - only when this tap is the user's LATEST intent for the message
//           and the write carrying it failed or timed out (one toast per
//           failure: when several taps share that write, the last one
//           reports, the others resolve true);
//   true  - otherwise: saved, no write needed, or replaced by a newer tap
//           (including a failed write that a newer tap superseded; the newer
//           one reports).
// reset() (account switch / sign-out) drops everything: in-flight writes
// are aborted and ignored, nothing queued is sent, and pending set()
// promises resolve true so no stale toast reaches the next account.
//
// No React imports, so tests/reactionWrites.test.ts runs under plain node.
import type { QuickReaction } from "./reactions.ts";

export type ReactionState = QuickReaction | null;

export const REACTION_WRITE_TIMEOUT_MS = 15_000;

export const REACTION_WRITE_TIMEOUT_ERROR = Object.freeze({ code: "reaction_write_timeout", message: "Reaction write timed out." });

export interface ReactionSettleInfo {
  // A timeout happened after the last confirmed write: the server may hold
  // something else than `saved`. Refetch before trusting it.
  uncertain: boolean;
}

export interface ReactionWriteRequest {
  // What the server is believed to hold now (the shown state, from the last
  // fetch). Used only when nothing is pending for this message.
  saved: ReactionState;
  // Sends one write; resolves to the error (null/undefined = saved). A
  // rejection or throw counts as an error. `signal` aborts on timeout/reset.
  write: (messageId: string, emoji: ReactionState, signal: AbortSignal) => Promise<unknown>;
  // Nothing is pending for this message any more; `saved` is the last state
  // the server confirmed (the rollback target after a failure).
  onSettled?: (messageId: string, saved: ReactionState, info: ReactionSettleInfo) => void;
  // A write that had already timed out succeeded after all.
  onLateSuccess?: (messageId: string) => void;
}

export interface ReactionWriteQueueOptions {
  timeoutMs?: number;
}

export interface ReactionWriteQueue {
  set: (messageId: string, emoji: ReactionState, request: ReactionWriteRequest) => Promise<boolean>;
  // The latest wanted state for each message with a write pending, to lay
  // over fetched rows (a fetch or realtime echo can't undo a pending tap).
  pending: () => Map<string, ReactionState>;
  reset: () => void;
}

const UNKNOWN = Symbol("unknown");

interface Slot {
  emoji: ReactionState;
  waiters: ((ok: boolean) => void)[];
}

interface Entry {
  confirmed: ReactionState; // last state the server confirmed (rollback target)
  server: ReactionState | typeof UNKNOWN; // what it holds now, if known
  uncertain: boolean;
  inFlight: Slot; // an entry exists exactly while a write is in flight
  abort: AbortController;
  queued: Slot | null;
  write: ReactionWriteRequest["write"];
  onSettled?: ReactionWriteRequest["onSettled"];
  onLateSuccess?: ReactionWriteRequest["onLateSuccess"];
}

const resolveAll = (slot: Slot, ok: boolean) => {
  for (const w of slot.waiters) w(ok);
};

// The failed write carried the latest intent: only its last tap reports.
const resolveFailed = (slot: Slot) => {
  slot.waiters.forEach((w, i) => w(i < slot.waiters.length - 1));
};

export function createReactionWriteQueue(options: ReactionWriteQueueOptions = {}): ReactionWriteQueue {
  const timeoutMs = options.timeoutMs ?? REACTION_WRITE_TIMEOUT_MS;
  let entries = new Map<string, Entry>();
  let epoch = 0;

  function send(messageId: string, entry: Entry) {
    const slot = entry.inFlight;
    const sentEpoch = epoch;
    const controller = new AbortController();
    entry.abort = controller;
    let outcome: "pending" | "ok" | "error" | "timeout" = "pending";

    const settle = (result: "ok" | "error" | "timeout") => {
      if (outcome !== "pending") return;
      outcome = result;
      clearTimeout(timer);
      // Reset since (account switch): not ours any more.
      if (sentEpoch !== epoch || entries.get(messageId) !== entry) return;
      if (result === "ok") {
        entry.confirmed = slot.emoji;
        entry.server = slot.emoji;
        entry.uncertain = false;
      } else if (result === "timeout") {
        entry.server = UNKNOWN;
        entry.uncertain = true;
        controller.abort();
      }
      const ok = result === "ok";
      const next = entry.queued;
      entry.queued = null;
      if (next && (entry.server === UNKNOWN || next.emoji !== entry.server)) {
        entry.inFlight = next;
        send(messageId, entry);
        resolveAll(slot, true); // saved, or superseded by the newer tap
        return;
      }
      entries.delete(messageId);
      entry.onSettled?.(messageId, entry.confirmed, { uncertain: entry.uncertain });
      if (ok || next) resolveAll(slot, true);
      else resolveFailed(slot);
      if (next) resolveAll(next, true); // already what the server has
    };

    const timer = setTimeout(() => settle("timeout"), timeoutMs);

    let request: Promise<unknown>;
    try {
      request = Promise.resolve(entry.write(messageId, slot.emoji, controller.signal));
    } catch (thrown) {
      request = Promise.reject(thrown);
    }
    request
      .then(
        (error) => error ?? null,
        (thrown: unknown) => thrown ?? new Error("reaction write failed"),
      )
      .then((error) => {
        if (outcome === "timeout") {
          if (error === null && sentEpoch === epoch) entry.onLateSuccess?.(messageId);
          return;
        }
        settle(error === null ? "ok" : "error");
      });
  }

  return {
    set(messageId, emoji, request) {
      return new Promise<boolean>((resolve) => {
        const entry = entries.get(messageId);
        if (!entry) {
          if (emoji === request.saved) {
            resolve(true);
            return;
          }
          const created: Entry = {
            confirmed: request.saved,
            server: request.saved,
            uncertain: false,
            inFlight: { emoji, waiters: [resolve] },
            abort: new AbortController(),
            queued: null,
            write: request.write,
            onSettled: request.onSettled,
            onLateSuccess: request.onLateSuccess,
          };
          entries.set(messageId, created);
          send(messageId, created);
          return;
        }
        entry.write = request.write;
        entry.onSettled = request.onSettled;
        entry.onLateSuccess = request.onLateSuccess;
        if (entry.queued) {
          resolveAll(entry.queued, true); // replaced before it was sent
          entry.queued = null;
        }
        if (entry.inFlight.emoji === emoji) entry.inFlight.waiters.push(resolve);
        else entry.queued = { emoji, waiters: [resolve] };
      });
    },
    pending() {
      const out = new Map<string, ReactionState>();
      for (const [messageId, entry] of entries) out.set(messageId, (entry.queued ?? entry.inFlight).emoji);
      return out;
    },
    reset() {
      epoch += 1;
      const dropped = entries;
      entries = new Map();
      for (const entry of dropped.values()) {
        entry.abort.abort();
        resolveAll(entry.inFlight, true);
        if (entry.queued) resolveAll(entry.queued, true);
      }
    },
  };
}
