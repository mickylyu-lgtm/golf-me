// Server-side ordering of my reaction writes (migration
// 20261106160000_order_message_reaction_writes). The write queue
// (lib/reactionWrites.ts) keeps one write in flight per message, but a
// request that timed out can still reach the server AFTER the newer one;
// without ordering it would be applied last and the older state would win.
//
// Every write now carries client_seq, and the server ignores (no error, 0
// rows) a write whose client_seq is lower than the stored one. Removing is a
// tombstone upsert (emoji NULL) so a late "add" can't resurrect it.
//
// client_seq = max(now in microseconds, last issued + 1, stored seq last
// fetched for that message + 1): monotonic on this device across reloads
// (wall clock), and above anything this device has seen from another device.
// Microseconds since 1970 stay below 2^53 until the year 2255.
//
// Rollout (both halves safe alone):
//   * migration not applied: the first sequenced write fails with "column
//     client_seq not found"; ordering is marked unsupported for this
//     account/session and that same write is retried ONCE the old way
//     (upsert without client_seq, DELETE to remove). Later writes go the old
//     way directly.
//   * old clients keep sending the old upsert/DELETE; the server applies
//     them as before.
// A refused tombstone (uniform reaction_not_allowed: under a block, on an
// unsent message, ...) falls back ONCE to the old DELETE, which stays
// allowed across a block; a late add is refused there by the same rules.
// No other retry: anything else is returned to the queue as the failure.
//
// Custom emoji (the "+" picker, migration 20261107160000): a value that
// isn't one reaction emoji is never sent; a custom one isn't sent while the
// database is known not to take it; one refused by the emoji check marks
// custom reactions unsupported for the session (lib/customReactions.ts).
//
// No React imports, so tests/reactionOrder.test.ts runs under plain node.
import { customReactionSupport, isEmojiCheckViolation, type CustomReactionSupportStore } from "./customReactions.ts";
import { isCustomReaction, isReactionEmoji, type QuickReaction } from "./reactions.ts";

export const INVALID_REACTION_EMOJI_ERROR = Object.freeze({ code: "invalid_reaction_emoji", message: "Not a single reaction emoji." });
export const CUSTOM_REACTIONS_UNSUPPORTED_ERROR = Object.freeze({ code: "custom_reactions_unsupported", message: "Custom reaction emoji aren't enabled on the server." });

export type OrderingSupport = "unknown" | "yes" | "no";

export interface ReactionSeqClock {
  // The sequence for a write being sent now.
  next: (messageId: string, nowMs: number) => number;
  // A stored sequence seen in fetched rows (mine, any device).
  observe: (messageId: string, seq: number) => void;
  reset: () => void;
}

export function createReactionSeqClock(): ReactionSeqClock {
  let lastIssued = 0;
  let seen = new Map<string, number>();
  return {
    next(messageId, nowMs) {
      const seq = Math.max(Math.floor(nowMs * 1000), lastIssued + 1, (seen.get(messageId) ?? 0) + 1);
      lastIssued = seq;
      seen.set(messageId, seq);
      return seq;
    },
    observe(messageId, seq) {
      if (!Number.isSafeInteger(seq) || seq <= 0) return;
      if (seq > (seen.get(messageId) ?? 0)) seen.set(messageId, seq);
    },
    reset() {
      lastIssued = 0;
      seen = new Map();
    },
  };
}

// client_seq as fetched (PostgREST sends bigint as a JSON number; a string
// is accepted too). null = absent / not a sequence.
export function reactionSeqFromRow(row: { client_seq?: unknown }): number | null {
  const v = row.client_seq;
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Fetched rows prove the migration: only then does a row have client_seq.
export function rowsShowOrdering(rows: readonly object[]): boolean {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, "client_seq"));
}

// PostgREST PGRST204 "Could not find the 'client_seq' column of
// 'message_reactions' in the schema cache", or Postgres 42703.
export function isMissingClientSeqError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (code === "PGRST204" || code === "42703") && typeof message === "string" && message.includes("client_seq");
}

// The database's refusal (uniform reaction_not_allowed, or RLS): 42501.
export function isReactionRefusal(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "42501");
}

export interface ReactionUpsertRow {
  message_id: string;
  user_id: string;
  emoji: QuickReaction | null;
  client_seq?: number;
}

// The two requests the client can send; each resolves to the error or null.
export interface ReactionTransport {
  upsert: (row: ReactionUpsertRow, signal: AbortSignal) => Promise<unknown>;
  remove: (messageId: string, signal: AbortSignal) => Promise<unknown>;
}

export interface ReactionWriteContext {
  transport: ReactionTransport;
  clock: ReactionSeqClock;
  // Shared, mutable: what this account/session knows about the migration.
  ordering: { support: OrderingSupport };
  userId: string;
  now: () => number;
  // Defaults to the app-wide store; tests pass their own.
  customSupport?: CustomReactionSupportStore;
}

// One write as the queue sees it: resolves to the error (null = saved). At
// most two requests (the one fallback above), never a loop.
export async function sendReactionWrite(ctx: ReactionWriteContext, messageId: string, emoji: QuickReaction | null, signal: AbortSignal): Promise<unknown> {
  const custom = ctx.customSupport ?? customReactionSupport;
  if (emoji !== null && !isReactionEmoji(emoji)) return INVALID_REACTION_EMOJI_ERROR;
  const isCustom = emoji !== null && isCustomReaction(emoji);
  if (isCustom && custom.get() === "no") return CUSTOM_REACTIONS_UNSUPPORTED_ERROR;
  const result = await sendOrdered(ctx, messageId, emoji, signal);
  if (isCustom && isEmojiCheckViolation(result)) custom.markRefused();
  return result;
}

async function sendOrdered(ctx: ReactionWriteContext, messageId: string, emoji: QuickReaction | null, signal: AbortSignal): Promise<unknown> {
  const legacy = () =>
    emoji ? ctx.transport.upsert({ message_id: messageId, user_id: ctx.userId, emoji }, signal) : ctx.transport.remove(messageId, signal);
  if (ctx.ordering.support === "no") return (await legacy()) ?? null;

  const seq = ctx.clock.next(messageId, ctx.now());
  const error = (await ctx.transport.upsert({ message_id: messageId, user_id: ctx.userId, emoji, client_seq: seq }, signal)) ?? null;
  if (error === null) {
    ctx.ordering.support = "yes";
    return null;
  }
  if (signal.aborted) return error;
  if (isMissingClientSeqError(error)) {
    ctx.ordering.support = "no";
    return (await legacy()) ?? null;
  }
  if (emoji === null && isReactionRefusal(error)) return (await ctx.transport.remove(messageId, signal)) ?? null;
  return error;
}
