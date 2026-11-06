// Run: npm run test:roundchat  (node --test, built-in type stripping)
// A round chat message refused by the content filter (P0001
// objectionable_content) while the golfer is already typing the next one,
// or has moved to another round. The send pipeline below is the real one
// from lib/roundChat.ts (createPendingRoundMessage -> settleRoundSend ->
// mergeRoundMessages, retry gate, Edit rule); only the network and the
// composers are faked, keyed by round id like GroupChat's drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRetryRoundMessage,
  classifyRoundSendError,
  createPendingRoundMessage,
  discardRoundMessage,
  editRejectedOutcome,
  markRoundMessageRetrying,
  mergeRoundMessages,
  settleRoundSend,
  type PendingRoundMessage,
} from "../src/lib/roundChat.ts";
import { OBJECTIONABLE_CONTENT_TOKEN } from "../src/lib/objectionableContent.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const FILTER_ERROR = { code: "P0001", message: `${OBJECTIONABLE_CONTENT_TOKEN}: blocked term`, hint: OBJECTIONABLE_CONTENT_TOKEN };
const NETWORK_ERROR = { code: "", message: "TypeError: Failed to fetch" };

type Answer = { data?: { id: string; created_at: string } | null; error?: unknown };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

// One device: the pending list (RealRoundsContext), one composer per
// round (GroupChat's drafts), and which round is on screen.
function device() {
  let pending: PendingRoundMessage[] = [];
  const composers = new Map<string, { text: string; replyToId: string | null }>();
  let onScreen = "r1";
  let n = 0;
  const composer = (roundId: string) => {
    if (!composers.has(roundId)) composers.set(roundId, { text: "", replyToId: null });
    return composers.get(roundId)!;
  };
  return {
    get pending() {
      return pending;
    },
    composer,
    get onScreen() {
      return onScreen;
    },
    navigate(roundId: string) {
      onScreen = roundId;
    },
    type(text: string) {
      composer(onScreen).text = text;
    },
    // GroupChat.handleSend: clear the composer, add the pending bubble,
    // await the insert, apply ONLY the settle (never the composer).
    async send(text: string, insert: () => Promise<Answer>) {
      const roundId = onScreen;
      composer(roundId).text = "";
      composer(roundId).replyToId = null;
      n += 1;
      const clientId = `temp-${n}`;
      pending = [...pending, createPendingRoundMessage({ clientId, roundId, senderId: "me", text: text.trim() })];
      const settled = settleRoundSend(clientId, await insert());
      pending = settled.apply(pending);
      return { clientId, result: settled.result };
    },
    async retry(clientId: string, insert: () => Promise<Answer>) {
      const p = pending.find((x) => x.clientId === clientId);
      if (!p || !canRetryRoundMessage(p)) return "refused" as const;
      pending = markRoundMessageRetrying(pending, clientId);
      const settled = settleRoundSend(clientId, await insert());
      pending = settled.apply(pending);
      return settled.result;
    },
    // GroupChat.handleEditRejected (+ putRejectedBack when allowed).
    edit(clientId: string, confirmReplace = false) {
      const p = pending.find((x) => x.clientId === clientId)!;
      const c = composer(onScreen);
      const outcome = editRejectedOutcome({ roundId: onScreen, text: c.text, replyToId: c.replyToId }, { roundId: p.roundId });
      if (outcome === "restore" || (outcome === "confirmReplace" && confirmReplace)) {
        c.text = p.text;
        c.replyToId = p.replyToId ?? null;
        pending = discardRoundMessage(pending, clientId);
      }
      return outcome;
    },
    shown(roundId: string) {
      return mergeRoundMessages([], pending, roundId);
    },
  };
}

test("delayed rejection: A stays as a failed 'objectionable' bubble, B in the composer is untouched", async () => {
  const d = device();
  const answer = deferred<Answer>();
  const sendA = d.send("A bad word", () => answer.promise);
  assert.equal(d.shown("r1")[0].delivery, "sending");
  d.type("B, typed while A was pending");
  answer.resolve({ error: FILTER_ERROR });
  const { clientId, result } = await sendA;
  assert.equal(result, "objectionable");
  assert.equal(d.composer("r1").text, "B, typed while A was pending");
  const [a] = d.shown("r1");
  assert.equal(a.text, "A bad word");
  assert.equal(a.delivery, "failed");
  assert.equal(a.failure, "objectionable");
  assert.equal(a.clientId, clientId);
});

test("rejected content is never resent: no Retry, retry() refuses, markRoundMessageRetrying is a no-op", async () => {
  const d = device();
  const { clientId } = await d.send("A bad word", async () => ({ error: FILTER_ERROR }));
  const before = d.pending;
  assert.equal(canRetryRoundMessage(d.shown("r1")[0]), false);
  let inserts = 0;
  assert.equal(
    await d.retry(clientId, async () => {
      inserts += 1;
      return {};
    }),
    "refused",
  );
  assert.equal(inserts, 0);
  assert.deepEqual(markRoundMessageRetrying(before, clientId), before);
});

test("Edit with an empty composer puts A back (with its quote) and removes the bubble", async () => {
  const d = device();
  const { clientId } = await d.send("A bad word", async () => ({ error: FILTER_ERROR }));
  assert.equal(d.edit(clientId), "restore");
  assert.equal(d.composer("r1").text, "A bad word");
  assert.equal(d.shown("r1").length, 0);
});

test("Edit with a newer draft asks first; declining keeps both, confirming replaces", async () => {
  const d = device();
  const { clientId } = await d.send("A bad word", async () => ({ error: FILTER_ERROR }));
  d.type("B draft");
  assert.equal(d.edit(clientId), "confirmReplace");
  assert.equal(d.composer("r1").text, "B draft", "nothing overwritten without asking");
  assert.equal(d.shown("r1").length, 1, "A is still recoverable");
  assert.equal(d.edit(clientId, true), "confirmReplace");
  assert.equal(d.composer("r1").text, "A bad word");
  assert.equal(d.shown("r1").length, 0);
});

test("a reply picked (empty text) also counts as a newer draft", () => {
  assert.equal(editRejectedOutcome({ roundId: "r1", text: "  ", replyToId: "m9" }, { roundId: "r1" }), "confirmReplace");
  assert.equal(editRejectedOutcome({ roundId: "r1", text: "", replyToId: null }, { roundId: "r1" }), "restore");
});

test("navigating to another round before the rejection lands: the other round's composer is never touched", async () => {
  const d = device();
  const answer = deferred<Answer>();
  const sendA = d.send("A bad word", () => answer.promise);
  d.navigate("r2");
  d.type("hello round two");
  answer.resolve({ error: FILTER_ERROR });
  await sendA;
  assert.equal(d.composer("r2").text, "hello round two");
  assert.equal(d.composer("r1").text, "");
  assert.equal(d.shown("r2").length, 0, "A never shows in round 2");
  assert.equal(d.shown("r1")[0].failure, "objectionable", "A waits in round 1");
  const clientId = d.shown("r1")[0].clientId!;
  // Edit can only act from round 1's own screen.
  assert.equal(d.edit(clientId), "otherRound");
  assert.equal(d.composer("r2").text, "hello round two");
  d.navigate("r1");
  assert.equal(d.edit(clientId), "restore");
  assert.equal(d.composer("r1").text, "A bad word");
});

test("two rounds in flight: each answer only changes its own message", async () => {
  const d = device();
  const a1 = deferred<Answer>();
  const a2 = deferred<Answer>();
  const s1 = d.send("one", () => a1.promise);
  d.navigate("r2");
  const s2 = d.send("two", () => a2.promise);
  a2.resolve({ data: { id: "srv-2", created_at: "2026-11-06T12:00:00Z" } });
  a1.resolve({ error: FILTER_ERROR });
  await Promise.all([s1, s2]);
  assert.equal(d.shown("r1")[0].failure, "objectionable");
  assert.equal(d.shown("r2")[0].delivery, undefined);
  assert.equal(d.shown("r2")[0].id, "srv-2");
});

test("network failure: still offered Retry, and a retry can succeed", async () => {
  const d = device();
  const { clientId, result } = await d.send("A fine", async () => ({ error: NETWORK_ERROR }));
  assert.equal(result, "failed");
  const [a] = d.shown("r1");
  assert.equal(a.failure, "network");
  assert.equal(canRetryRoundMessage(a), true);
  const retried = deferred<Answer>();
  const run = d.retry(clientId, () => retried.promise);
  assert.equal(d.shown("r1")[0].delivery, "sending");
  assert.equal(await d.retry(clientId, async () => ({})), "refused", "no second send while one is in flight");
  retried.resolve({ data: { id: "srv-1", created_at: "2026-11-06T12:00:00Z" } });
  assert.equal(await run, "sent");
  assert.equal(d.shown("r1")[0].delivery, undefined);
});

test("a retry the filter then refuses turns into an Edit-only bubble", async () => {
  const d = device();
  const { clientId } = await d.send("A", async () => ({ error: NETWORK_ERROR }));
  assert.equal(await d.retry(clientId, async () => ({ error: FILTER_ERROR })), "objectionable");
  assert.equal(d.shown("r1")[0].failure, "objectionable");
  assert.equal(canRetryRoundMessage(d.shown("r1")[0]), false);
});

test("successful send: shown as sent, composer keeps what was typed after", async () => {
  const d = device();
  const answer = deferred<Answer>();
  const s = d.send("hi all", () => answer.promise);
  d.type("next");
  answer.resolve({ data: { id: "srv-9", created_at: "2026-11-06T12:00:00Z" } });
  assert.equal((await s).result, "sent");
  assert.equal(d.composer("r1").text, "next");
  const [m] = d.shown("r1");
  assert.equal(m.id, "srv-9");
  assert.equal(m.delivery, undefined);
});

test("classifyRoundSendError: content filter vs RLS vs network", () => {
  assert.equal(classifyRoundSendError(FILTER_ERROR), "objectionable");
  assert.equal(classifyRoundSendError({ message: "x", hint: OBJECTIONABLE_CONTENT_TOKEN }), "objectionable");
  assert.equal(classifyRoundSendError({ code: "42501", message: "rls" }), "rejected");
  assert.equal(classifyRoundSendError(NETWORK_ERROR), "network");
});

test("the new strings exist and are non-empty in all 6 locales", () => {
  const keys = [
    "roundChat.notSentFiltered",
    "roundChat.edit",
    "roundChat.editLabel",
    "roundChat.replaceDraftPrompt",
    "roundChat.replaceDraft",
    "roundChat.keepDraft",
  ] as const;
  for (const [name, dict] of Object.entries({ en, es, ja, ko, zhCN, zhTW })) {
    for (const k of keys) assert.ok((dict as Record<string, string>)[k]?.trim(), `${name} ${k}`);
  }
});
