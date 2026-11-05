// Quick reactions on DMs (hold a bubble -> emoji row). The database
// (public.message_reactions, migration 20261105150000) allows exactly these
// six strings, one reaction per user per message; picking a different one
// replaces it, picking the same one removes it. No React imports, so
// tests/reactions.test.ts runs under plain node.

// Same strings, same order, as the migration's message_reactions_emoji_check.
// The heart carries U+FE0F (emoji presentation): the bare U+2764 is refused.
export const QUICK_REACTIONS = ["❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"] as const;

export type QuickReaction = (typeof QUICK_REACTIONS)[number];

export interface MessageReaction {
  messageId: string;
  userId: string;
  emoji: QuickReaction;
}

export interface ReactionSummary {
  emoji: QuickReaction;
  count: number;
  mine: boolean;
}

export function isQuickReaction(value: unknown): value is QuickReaction {
  return typeof value === "string" && (QUICK_REACTIONS as readonly string[]).includes(value);
}

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

// The pill under a bubble: one entry per emoji, most used first (ties keep
// the row's order), with whether mine is among them.
export function summarizeReactions(reactions: readonly MessageReaction[], messageId: string, selfId: string): ReactionSummary[] {
  const byEmoji = new Map<QuickReaction, ReactionSummary>();
  for (const r of reactions) {
    if (r.messageId !== messageId) continue;
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (r.userId === selfId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || QUICK_REACTIONS.indexOf(a.emoji) - QUICK_REACTIONS.indexOf(b.emoji));
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

// Rows as fetched (snake_case, any extra columns), unknown emoji dropped
// rather than trusted.
export function reactionRowsToReactions(rows: readonly { message_id?: unknown; user_id?: unknown; emoji?: unknown }[]): MessageReaction[] {
  const out: MessageReaction[] = [];
  for (const row of rows) {
    if (typeof row.message_id !== "string" || typeof row.user_id !== "string" || !isQuickReaction(row.emoji)) continue;
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
export function isMissingReactionsTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "PGRST205" || code === "42P01") return true;
  return typeof message === "string" && message.includes("message_reactions") && /does not exist|schema cache/i.test(message);
}

// Who may be offered reactions on a bubble (the database decides for real).
export function canReactToMessage(m: { id: string; unsentAt?: string | null }): boolean {
  return !m.unsentAt && !m.id.startsWith("temp-");
}
