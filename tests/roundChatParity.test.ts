// Run: npm run test:roundchat  (node --test, built-in type stripping)
// Round chat parity with DMs (migration 20261107130000_round_chat_parity):
// the client's feature detection, the reply fallback, which messages can be
// held / quoted / reacted to, the reply + unsent fields through the merge,
// and a static guard on the migration itself (the live checks are the PGlite
// suite in the scratchpad and roundchat-parity-check.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPendingRoundMessage,
  isActionableRoundMessage,
  markRoundMessageSent,
  mergeRoundMessages,
  roundRowsHaveColumn,
  shouldResendWithoutReply,
} from "../src/lib/roundChat.ts";
import { classifyUnsendError } from "../src/lib/unsend.ts";
import { isMissingReactionsTableError } from "../src/lib/reactions.ts";

const ME = "me";

test("feature detection: replies / unsend only once fetched rows carry the columns", () => {
  const old = [{ id: "m1", round_id: "r1", sender_id: ME, text: "hi", created_at: "2026-11-05T14:00:00Z" }];
  assert.equal(roundRowsHaveColumn(old, "reply_to_message_id"), false);
  assert.equal(roundRowsHaveColumn(old, "unsent_at"), false);
  assert.equal(roundRowsHaveColumn([], "unsent_at"), false);
  const migrated = [{ ...old[0], reply_to_message_id: null, unsent_at: null }];
  assert.equal(roundRowsHaveColumn(migrated, "reply_to_message_id"), true);
  assert.equal(roundRowsHaveColumn(migrated, "unsent_at"), true);
});

test("feature detection: a missing reactions table hides reactions (no error)", () => {
  assert.equal(isMissingReactionsTableError({ code: "PGRST205", message: "Could not find the table 'public.round_message_reactions' in the schema cache" }), true);
  assert.equal(isMissingReactionsTableError({ code: "42P01", message: 'relation "public.round_message_reactions" does not exist' }), true);
  // the uniform refusal is NOT a missing table: reactions stay on, the tap fails
  assert.equal(isMissingReactionsTableError({ code: "42501", message: "reaction_not_allowed", hint: "reaction_not_allowed" }), false);
});

test("reply fallback: missing column or a quote from another round -> resend without it", () => {
  assert.equal(shouldResendWithoutReply({ code: "PGRST204", message: "Could not find the 'reply_to_message_id' column of 'round_messages' in the schema cache" }), true);
  assert.equal(shouldResendWithoutReply({ code: "42703", message: 'column "reply_to_message_id" of relation "round_messages" does not exist' }), true);
  assert.equal(shouldResendWithoutReply({ code: "23514", message: "reply_not_in_round: a reply must quote ...", hint: "reply_not_in_round" }), true);
  // everything else is a real failure (failed bubble, retry)
  assert.equal(shouldResendWithoutReply({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(shouldResendWithoutReply({ code: "PGRST204", message: "Could not find the 'other' column" }), false);
  assert.equal(shouldResendWithoutReply(null), false);
});

test("unsend: the round RPC's errors read like the DM one's", () => {
  assert.equal(classifyUnsendError({ code: "P0001", hint: "unsend_window_expired", message: "unsend_window_expired: ..." }), "expired");
  assert.equal(classifyUnsendError({ code: "42501", hint: "unsend_not_allowed", message: "unsend_not_allowed: ..." }), "failed");
  assert.equal(classifyUnsendError({ code: "PGRST202", message: "Could not find the function public.unsend_round_message" }), "failed");
});

test("actionable: stored, not sending/failed, not unsent, not a system line", () => {
  const base = { id: "m1", system: false, delivery: undefined, unsentAt: null };
  assert.equal(isActionableRoundMessage(base), true);
  assert.equal(isActionableRoundMessage({ ...base, delivery: "sending" as const }), false);
  assert.equal(isActionableRoundMessage({ ...base, delivery: "failed" as const }), false);
  assert.equal(isActionableRoundMessage({ ...base, unsentAt: "2026-11-05T14:00:00Z" }), false);
  assert.equal(isActionableRoundMessage({ ...base, system: true }), false);
  assert.equal(isActionableRoundMessage({ ...base, id: "temp-123" }), false);
});

test("merge: reply and unsent fields come through; a pending reply keeps its quote", () => {
  const rows = [
    { id: "m1", round_id: "r1", sender_id: "host", text: "", created_at: "2026-11-05T14:00:00Z", reply_to_message_id: null, unsent_at: "2026-11-05T14:01:00Z" },
    { id: "m2", round_id: "r1", sender_id: "host", text: "quote me", created_at: "2026-11-05T14:02:00Z", reply_to_message_id: "m1", unsent_at: null },
  ];
  const sending = createPendingRoundMessage({ clientId: "c1", roundId: "r1", senderId: ME, text: "reply", replyToId: "m2", now: new Date("2026-11-05T14:03:00Z") });
  const merged = mergeRoundMessages(rows, [sending], "r1");
  assert.equal(merged[0].unsentAt, "2026-11-05T14:01:00Z");
  assert.equal(merged[1].replyToId, "m1");
  assert.equal(merged[2].replyToId, "m2");
  assert.equal(merged[2].delivery, "sending");
  const sent = mergeRoundMessages(rows, markRoundMessageSent([sending], "c1", { id: "m3", created_at: "2026-11-05T14:03:01Z" }), "r1");
  assert.deepEqual(
    sent.map((m) => [m.id, m.replyToId ?? null]),
    [["m1", null], ["m2", "m1"], ["m3", "m2"]],
  );
  // rows from before the migration: no fields, read as null
  const legacy = mergeRoundMessages([{ id: "x", round_id: "r1", sender_id: ME, text: "hi", created_at: "2026-11-05T14:00:00Z" }], [], "r1");
  assert.equal(legacy[0].replyToId, null);
  assert.equal(legacy[0].unsentAt, null);
});

// --- static guard on the migration -------------------------------------------

const MIG = join(import.meta.dirname, "..", "supabase", "migrations", "20261107130000_round_chat_parity.sql");
const code = readFileSync(MIG, "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

test("migration: never touches round_messages' insert policy, the DM tables or the content filter", () => {
  assert.ok(!/round_messages_insert_member/.test(code));
  assert.ok(!/\bon public\.message_reactions\b|\btable public\.message_reactions\b|public\.messages\b/.test(code));
  assert.ok(!/filter_objectionable_text/.test(code));
  assert.ok(!/create policy [a-z_]+ on public\.round_messages/.test(code), "no client UPDATE/DELETE policy on round_messages");
});

test("migration: the reaction trigger authorizes before it locks the message", () => {
  const fn = code.slice(code.indexOf("create function private.prepare_round_message_reaction"), code.indexOf("create trigger round_message_reactions_prepare"));
  const authz = fn.indexOf("private.is_round_member(v_round_id)");
  const lock = fn.indexOf("for share");
  assert.ok(authz > 0 && lock > authz);
  assert.ok(!/reaction_message_unsent/.test(fn));
  assert.equal(fn.match(/raise exception 'reaction_not_allowed'/g)?.length, 1, "one error for every refusal");
});

test("migration: unsend authorizes (sender + still in the round) before the lock and the state checks", () => {
  const fn = code.slice(code.indexOf("create function public.unsend_round_message"), code.indexOf("revoke execute on function public.unsend_round_message"));
  const authz = fn.indexOf("v_msg.sender_id <> v_uid or not private.is_round_member(v_msg.round_id)");
  assert.ok(authz > 0);
  assert.ok(fn.indexOf("for update") > authz);
  assert.ok(fn.indexOf("already_unsent") > authz);
  assert.ok(fn.indexOf("unsend_window_expired") > authz);
  assert.ok(fn.indexOf("insert into private.unsent_round_message_copies") < fn.indexOf("set text = ''"), "copy before wipe");
});

test("migration: realtime, RLS and grants are in the same migration", () => {
  assert.ok(code.includes("alter table public.round_message_reactions enable row level security;"));
  assert.ok(code.includes("alter table private.unsent_round_message_copies enable row level security;"));
  assert.ok(code.includes("revoke all on table private.unsent_round_message_copies from public, anon, authenticated;"));
  assert.ok(code.includes("alter publication supabase_realtime add table public.round_message_reactions;"));
  assert.equal(code.match(/create policy round_message_reactions_/g)?.length, 4);
});
