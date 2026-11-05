// Run: npm run test:chat  (node --test, built-in type stripping)
// DM quick reactions: the six allowed emoji, set/replace/remove, the pill
// summary, the pending-write overlay, missing-table detection; plus the
// hold menu's contents and the iOS cancel rule of the long-press.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUICK_REACTIONS,
  canReactToMessage,
  groupReactionsByMessage,
  isMissingReactionsTableError,
  isQuickReaction,
  myReaction,
  nextReaction,
  overlayPendingReactions,
  reactionRowsToReactions,
  summarizeReactions,
  withReaction,
  type MessageReaction,
} from "../src/lib/reactions.ts";
import { longPressCancelledByMove, longPressSurvivesCancel, messageActions } from "../src/lib/messageLongPress.ts";
import { AXIS_SLOP_PX } from "../src/lib/chatSwipe.ts";

const [HEART, LAUGH, WOW, SAD, ANGRY, THUMBS] = QUICK_REACTIONS;

test("reactions: exactly the six Instagram-style emoji, heart with U+FE0F", () => {
  assert.deepEqual([...QUICK_REACTIONS], ["❤️", "😂", "😮", "😢", "😡", "👍"]);
  assert.equal(HEART, "❤️");
  assert.equal(isQuickReaction("❤"), false, "bare heart is refused by the database too");
  assert.equal(isQuickReaction("🔥"), false);
  assert.equal(isQuickReaction(""), false);
  assert.equal(isQuickReaction(null), false);
  for (const e of QUICK_REACTIONS) assert.equal(isQuickReaction(e), true);
});

test("reactions: the client's list matches the migration's check constraint", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261105150000_add_dm_message_reactions.sql", import.meta.url), "utf8");
  const check = sql.match(/check \(emoji in \(([^)]*)\)\)/);
  assert.ok(check, "check constraint present");
  const decoded = [...check[1].matchAll(/U&'((?:\\(?:\+[0-9A-F]{6}|[0-9A-F]{4}))+)'/gi)].map((m) =>
    m[1].replace(/\\\+([0-9A-F]{6})|\\([0-9A-F]{4})/gi, (_, six, four) => String.fromCodePoint(parseInt(six ?? four, 16))),
  );
  assert.deepEqual(decoded, [...QUICK_REACTIONS]);
});

test("reactions: tapping the same emoji removes it, another replaces it", () => {
  assert.equal(nextReaction(null, HEART), HEART);
  assert.equal(nextReaction(HEART, HEART), null);
  assert.equal(nextReaction(HEART, LAUGH), LAUGH);
});

test("reactions: withReaction keeps one per user per message", () => {
  let rows: MessageReaction[] = [];
  rows = withReaction(rows, "m1", "me", HEART);
  rows = withReaction(rows, "m1", "them", THUMBS);
  rows = withReaction(rows, "m1", "me", LAUGH);
  assert.equal(rows.filter((r) => r.messageId === "m1" && r.userId === "me").length, 1);
  assert.equal(myReaction(rows, "m1", "me"), LAUGH);
  assert.equal(myReaction(rows, "m1", "them"), THUMBS);
  rows = withReaction(rows, "m1", "me", null);
  assert.equal(myReaction(rows, "m1", "me"), null);
  assert.deepEqual(rows, [{ messageId: "m1", userId: "them", emoji: THUMBS }]);
  assert.equal(myReaction(rows, "m2", "me"), null);
});

test("reactions: summary groups by emoji, most used first, marks mine", () => {
  const rows: MessageReaction[] = [
    { messageId: "m1", userId: "a", emoji: SAD },
    { messageId: "m1", userId: "b", emoji: HEART },
    { messageId: "m1", userId: "me", emoji: HEART },
    { messageId: "m2", userId: "me", emoji: ANGRY },
  ];
  assert.deepEqual(summarizeReactions(rows, "m1", "me"), [
    { emoji: HEART, count: 2, mine: true },
    { emoji: SAD, count: 1, mine: false },
  ]);
  assert.deepEqual(summarizeReactions(rows, "m3", "me"), []);
  // ties keep the row's order (😮 before 👍)
  const tie: MessageReaction[] = [
    { messageId: "x", userId: "a", emoji: THUMBS },
    { messageId: "x", userId: "b", emoji: WOW },
  ];
  assert.deepEqual(summarizeReactions(tie, "x", "me").map((s) => s.emoji), [WOW, THUMBS]);
});

test("reactions: grouping by message keeps every row once", () => {
  const rows: MessageReaction[] = [
    { messageId: "m1", userId: "a", emoji: SAD },
    { messageId: "m2", userId: "a", emoji: HEART },
    { messageId: "m1", userId: "b", emoji: HEART },
  ];
  const g = groupReactionsByMessage(rows);
  assert.deepEqual([...g.keys()], ["m1", "m2"]);
  assert.equal(g.get("m1")?.length, 2);
  assert.deepEqual(summarizeReactions(g.get("m1") ?? [], "m1", "b"), summarizeReactions(rows, "m1", "b"));
});

test("reactions: fetched rows are validated, unknown emoji dropped", () => {
  assert.deepEqual(
    reactionRowsToReactions([
      { message_id: "m1", user_id: "a", emoji: HEART, conversation_id: "c" } as never,
      { message_id: "m1", user_id: "b", emoji: "🔥" },
      { message_id: 7, user_id: "b", emoji: HEART },
    ]),
    [{ messageId: "m1", userId: "a", emoji: HEART }],
  );
});

test("reactions: writes in flight win over a fetch that started before them", () => {
  const fetched: MessageReaction[] = [
    { messageId: "m1", userId: "me", emoji: HEART },
    { messageId: "m2", userId: "them", emoji: SAD },
  ];
  const pending = new Map([
    ["m1", null],
    ["m2", LAUGH],
  ] as const);
  assert.deepEqual(overlayPendingReactions(fetched, pending, "me"), [
    { messageId: "m2", userId: "them", emoji: SAD },
    { messageId: "m2", userId: "me", emoji: LAUGH },
  ]);
  assert.deepEqual(overlayPendingReactions(fetched, new Map(), "me"), fetched);
});

test("reactions: missing table (migration not applied) is recognised, other errors aren't", () => {
  assert.equal(isMissingReactionsTableError({ code: "PGRST205", message: "Could not find the table 'public.message_reactions' in the schema cache" }), true);
  assert.equal(isMissingReactionsTableError({ code: "42P01", message: 'relation "public.message_reactions" does not exist' }), true);
  assert.equal(isMissingReactionsTableError({ message: 'relation "public.message_reactions" does not exist' }), true);
  assert.equal(isMissingReactionsTableError({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(isMissingReactionsTableError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isMissingReactionsTableError(null), false);
  assert.equal(isMissingReactionsTableError("boom"), false);
});

test("reactions: never on an unsent or still-sending message", () => {
  assert.equal(canReactToMessage({ id: "m1" }), true);
  assert.equal(canReactToMessage({ id: "m1", unsentAt: null }), true);
  assert.equal(canReactToMessage({ id: "m1", unsentAt: "2026-11-05T00:00:00Z" }), false);
  assert.equal(canReactToMessage({ id: "temp-123" }), false);
});

test("hold menu: Reply when replying is possible, Copy always, Unsend only inside the window", () => {
  assert.deepEqual(messageActions({ canReply: true, canUnsend: true }), ["reply", "copy", "unsend"]);
  assert.deepEqual(messageActions({ canReply: true, canUnsend: false }), ["reply", "copy"], "their message / my old message");
  assert.deepEqual(messageActions({ canReply: false, canUnsend: false }), ["copy"], "blocked thread");
});

test("long-press: a cancel without movement (WebKit claiming a still hold) keeps the press", () => {
  assert.equal(longPressSurvivesCancel(0, 0), true);
  assert.equal(longPressSurvivesCancel(AXIS_SLOP_PX - 1, -(AXIS_SLOP_PX - 1)), true);
  assert.equal(longPressSurvivesCancel(0, AXIS_SLOP_PX), false, "a scroll moved first: cancelled");
  assert.equal(longPressSurvivesCancel(-AXIS_SLOP_PX, 0), false, "a swipe moved first: cancelled");
  // exactly the complement of the move rule, so the two can never disagree
  for (const [dx, dy] of [[0, 0], [3, 7], [8, 0], [0, -9], [20, 20]]) {
    assert.equal(longPressSurvivesCancel(dx, dy), !longPressCancelledByMove(dx, dy));
  }
});
