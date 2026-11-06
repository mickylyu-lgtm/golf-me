// Run: npm run test:chat  (node --test, built-in type stripping)
// Whether "+" (custom reaction emoji) is offered: the probe and the
// refused-write fallback (lib/customReactions.ts), and how the shared write
// path (lib/reactionOrder.ts sendReactionWrite) treats custom emoji.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustomReactionSupport, isEmojiCheckViolation, isMissingProbeFunctionError, PROBE_EMOJI } from "../src/lib/customReactions.ts";
import {
  CUSTOM_REACTIONS_UNSUPPORTED_ERROR,
  INVALID_REACTION_EMOJI_ERROR,
  createReactionSeqClock,
  sendReactionWrite,
  type ReactionTransport,
  type ReactionUpsertRow,
} from "../src/lib/reactionOrder.ts";
import { isCustomReaction } from "../src/lib/reactions.ts";

const OLD_CHECK = { code: "23514", message: 'new row for relation "message_reactions" violates check constraint "message_reactions_emoji_check"' };
const ROUND_CHECK = { code: "23514", message: 'new row for relation "round_message_reactions" violates check constraint "round_message_reactions_emoji_check"' };

test("probe: the function answering true = supported, not found = unsupported", async () => {
  const yes = createCustomReactionSupport();
  assert.equal(await yes.probe(async () => ({ data: true, error: null })), "yes");
  const no = createCustomReactionSupport();
  assert.equal(await no.probe(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.is_reaction_emoji(p_emoji) in the schema cache" } })), "no");
  const no2 = createCustomReactionSupport();
  assert.equal(await no2.probe(async () => ({ data: null, error: { code: "42883", message: "function public.is_reaction_emoji(text) does not exist" } })), "no");
  const odd = createCustomReactionSupport();
  assert.equal(await odd.probe(async () => ({ data: false, error: null })), "no", "false (shouldn't happen) = hide");
});

test("probe: network trouble stays unknown and the next fetch asks again; answers are asked once", async () => {
  const s = createCustomReactionSupport();
  assert.equal(await s.probe(async () => ({ data: null, error: { message: "TypeError: Failed to fetch" } })), "unknown");
  assert.equal(await s.probe(async () => Promise.reject(new Error("offline"))), "unknown");
  let calls = 0;
  const call = async () => {
    calls++;
    return { data: true, error: null };
  };
  const [a, b] = await Promise.all([s.probe(call), s.probe(call)]);
  assert.equal(a, "yes");
  assert.equal(b, "yes");
  assert.equal(calls, 1, "concurrent probes share one request");
  await s.probe(call);
  assert.equal(calls, 1, "known: never asked again this page load");
});

test("probe: subscribers hear the change once; a refusal wins over a late yes", async () => {
  const s = createCustomReactionSupport();
  let heard = 0;
  const off = s.subscribe(() => heard++);
  let release!: (v: { data: unknown; error: unknown }) => void;
  const pending = s.probe(() => new Promise((r) => (release = r)));
  s.markRefused();
  release({ data: true, error: null });
  assert.equal(await pending, "no");
  assert.equal(s.get(), "no");
  assert.equal(heard, 1);
  off();
  s.markRefused();
  assert.equal(heard, 1);
});

test("error shapes", () => {
  assert.equal(isEmojiCheckViolation(OLD_CHECK), true);
  assert.equal(isEmojiCheckViolation(ROUND_CHECK), true);
  assert.equal(isEmojiCheckViolation({ code: "23514", message: 'violates check constraint "round_messages_text_check"' }), false);
  assert.equal(isEmojiCheckViolation({ code: "42501", message: "reaction_not_allowed" }), false);
  assert.equal(isEmojiCheckViolation(null), false);
  assert.equal(isMissingProbeFunctionError({ code: "42501", message: "permission denied for function is_reaction_emoji" }), false);
  assert.equal(isCustomReaction(PROBE_EMOJI), true, "the probe asks about a custom emoji");
});

function harness(respond: (row: ReactionUpsertRow) => unknown) {
  const sent: ReactionUpsertRow[] = [];
  const transport: ReactionTransport = {
    upsert: async (row) => {
      sent.push(row);
      return respond(row);
    },
    remove: async () => null,
  };
  const customSupport = createCustomReactionSupport();
  const ctx = { transport, clock: createReactionSeqClock(), ordering: { support: "yes" as const } as { support: "unknown" | "yes" | "no" }, userId: "me", now: () => 1_000, customSupport };
  return { sent, ctx, customSupport, signal: new AbortController().signal };
}

test("write: a custom emoji is sent like any other when supported", async () => {
  const h = harness(() => null);
  await h.customSupport.probe(async () => ({ data: true, error: null }));
  assert.equal(await sendReactionWrite(h.ctx, "m1", "🔥", h.signal), null);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].emoji, "🔥");
  assert.ok(h.sent[0].client_seq, "sequenced as before");
});

test("write: an old database refusing a custom emoji hides '+' for the session", async () => {
  const h = harness((row) => (row.emoji === "🔥" ? ROUND_CHECK : null));
  assert.deepEqual(await sendReactionWrite(h.ctx, "m1", "🔥", h.signal), ROUND_CHECK, "the page shows its usual toast");
  assert.equal(h.customSupport.get(), "no");
  assert.equal(await sendReactionWrite(h.ctx, "m1", "⛳", h.signal), CUSTOM_REACTIONS_UNSUPPORTED_ERROR, "not even sent now");
  assert.equal(h.sent.length, 1);
  assert.equal(await sendReactionWrite(h.ctx, "m1", "❤️", h.signal), null, "the six still work");
  assert.equal(await sendReactionWrite(h.ctx, "m1", null, h.signal), null, "and removing");
});

test("write: a quick emoji refused by a check never hides '+'", async () => {
  const h = harness(() => OLD_CHECK);
  await sendReactionWrite(h.ctx, "m1", "👍", h.signal);
  assert.equal(h.customSupport.get(), "unknown");
});

test("write: anything that isn't one emoji is never sent", async () => {
  const h = harness(() => null);
  for (const v of ["hello", "🔥🔥", "", "❤"]) assert.equal(await sendReactionWrite(h.ctx, "m1", v, h.signal), INVALID_REACTION_EMOJI_ERROR, v);
  assert.equal(h.sent.length, 0);
});
