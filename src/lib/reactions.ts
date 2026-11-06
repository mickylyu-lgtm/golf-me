// Reactions on DMs and round chat (hold a bubble -> emoji row, or "+" for
// any emoji). One reaction per user per message; picking a different one
// replaces it, picking the same one removes it. No React imports, so
// tests/reactions.test.ts runs under plain node.
import { isReactionEmoji } from "./reactionEmoji.ts";

// The fixed quick row, same strings and order as the first check
// constraint (migration 20261105150000). The heart carries U+FE0F (emoji
// presentation): the bare U+2764 is refused. Since migration
// 20261107160000 the database also takes any single emoji
// (lib/reactionEmoji.ts); the row itself stays these six.
export const QUICK_REACTIONS = ["❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"] as const;

export type FixedQuickReaction = (typeof QUICK_REACTIONS)[number];

// Any one reaction emoji (isReactionEmoji): one of the six or a custom one.
export type ReactionEmoji = string;
// Older name, kept because its callers (DirectMessageThread, frozen) pass
// whatever the menu picked; it now means any reaction emoji.
export type QuickReaction = ReactionEmoji;

export interface MessageReaction {
  messageId: string;
  userId: string;
  emoji: ReactionEmoji;
}

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
}

// One of the six in the quick row.
export function isQuickReaction(value: unknown): value is FixedQuickReaction {
  return typeof value === "string" && (QUICK_REACTIONS as readonly string[]).includes(value);
}

// A custom reaction: a valid emoji that isn't in the quick row.
export function isCustomReaction(value: unknown): value is ReactionEmoji {
  return isReactionEmoji(value) && !isQuickReaction(value);
}

export { isReactionEmoji };

// Tapping an emoji in the row: the same one again takes it back.
export function nextReaction(current: QuickReaction | null, tapped: QuickReaction): QuickReaction | null {
  return current === tapped ? null : tapped;
}

export function myReaction(reactions: readonly MessageReaction[], messageId: string, selfId: string): QuickReaction | null {
  return reactions.find((r) => r.messageId === messageId && r.userId === selfId)?.emoji ?? null;
}

// The list with this user's reaction on this message set to `emoji`
// (replacing any previous one) or removed (null). Everything else is kept
// as is, in order.
export function withReaction(
  reactions: readonly MessageReaction[],
  messageId: string,
  userId: string,
  emoji: QuickReaction | null,
): MessageReaction[] {
  const rest = reactions.filter((r) => !(r.messageId === messageId && r.userId === userId));
  return emoji ? [...rest, { messageId, userId, emoji }] : rest;
}

// The pill under a bubble: one entry per emoji, most used first (ties: the
// row's order, then custom emoji in the order they were first seen), with
// whether mine is among them.
export function summarizeReactions(reactions: readonly MessageReaction[], messageId: string, selfId: string): ReactionSummary[] {
  const byEmoji = new Map<ReactionEmoji, ReactionSummary>();
  for (const r of reactions) {
    if (r.messageId !== messageId) continue;
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (r.userId === selfId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
  }
  const seen = [...byEmoji.keys()];
  const rank = (emoji: ReactionEmoji) => {
    const quick = (QUICK_REACTIONS as readonly string[]).indexOf(emoji);
    return quick >= 0 ? quick : QUICK_REACTIONS.length + seen.indexOf(emoji);
  };
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || rank(a.emoji) - rank(b.emoji));
}

// One pass over all reactions, so a thread doesn't rescan the whole list
// for every bubble on every render.
export function groupReactionsByMessage(reactions: readonly MessageReaction[]): Map<string, MessageReaction[]> {
  const out = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = out.get(r.messageId);
    if (list) list.push(r);
    else out.set(r.messageId, [r]);
  }
  return out;
}

// Rows as fetched (snake_case, any extra columns). Anything that isn't one
// reaction emoji (a tombstone's NULL, text) is dropped rather than trusted.
export function reactionRowsToReactions(rows: readonly { message_id?: unknown; user_id?: unknown; emoji?: unknown }[]): MessageReaction[] {
  const out: MessageReaction[] = [];
  for (const row of rows) {
    if (typeof row.message_id !== "string" || typeof row.user_id !== "string" || !isReactionEmoji(row.emoji)) continue;
    out.push({ messageId: row.message_id, userId: row.user_id, emoji: row.emoji });
  }
  return out;
}

// Writes still on their way to the server win over a fetch that may have
// started before them, so an optimistic pick never flickers back.
export function overlayPendingReactions(
  fetched: readonly MessageReaction[],
  pending: ReadonlyMap<string, QuickReaction | null>,
  selfId: string,
): MessageReaction[] {
  let out = [...fetched];
  for (const [messageId, emoji] of pending) out = withReaction(out, messageId, selfId, emoji);
  return out;
}

// The table isn't there yet (migration not applied): PostgREST PGRST205
// "Could not find the table ... in the schema cache", Postgres 42P01
// undefined_table. The client then hides reactions instead of erroring.
// A missing COLUMN (PGRST204 "Could not find the 'client_seq' column of
// 'message_reactions' in the schema cache", 42703) is not a missing table:
// the table is there, only the ordering migration isn't (lib/reactionOrder).
export function isMissingReactionsTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "PGRST205" || code === "42P01") return true;
  if (code === "PGRST204" || code === "42703") return false;
  return (
    typeof message === "string" &&
    message.includes("message_reactions") &&
    !/column/i.test(message) &&
    /does not exist|schema cache/i.test(message)
  );
}

// Who may be offered reactions on a bubble (the database decides for real).
export function canReactToMessage(m: { id: string; unsentAt?: string | null }): boolean {
  return !m.unsentAt && !m.id.startsWith("temp-");
}
