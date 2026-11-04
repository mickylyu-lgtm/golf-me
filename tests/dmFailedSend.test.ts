// Run: npm run test:chat  (node --test, built-in type stripping)
// DM thread: a slow send failure never overwrites newer input, and Back
// works when the thread was opened straight from a push or a link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type DmSendIo, type FailedDm, failedSendOutcome, sendDmWithRecovery } from "../src/lib/dmFailedSend.ts";
import type { SendMessageResult } from "../src/lib/objectionableContent.ts";
import { goBack } from "../src/lib/goBack.ts";

// A stand-in for the page: composer state, saved drafts, failed bubbles,
// and a send whose result the test releases later (a slow network).
function harness(thread = "golfer-1") {
  const page = {
    mounted: true,
    threadId: thread as string | undefined,
    text: "",
    replyToId: null as string | null,
    drafts: new Map<string, string>(),
    failed: [] as FailedDm[],
    sent: [] as { text: string; replyToId: string | null }[],
  };
  let release: (r: SendMessageResult) => void = () => {};
  const io = (text: string, replyToId: string | null): DmSendIo => ({
    threadId: thread,
    text,
    replyToId,
    clear: () => {
      page.text = "";
      page.replyToId = null;
      page.drafts.delete(thread);
    },
    send: (body, replyTo) => {
      page.sent.push({ text: body, replyToId: replyTo });
      return new Promise<SendMessageResult>((resolve) => (release = resolve));
    },
    snapshot: () => (page.mounted ? { threadId: page.threadId, text: page.text, replyToId: page.replyToId } : null),
    loadDraft: (t) => page.drafts.get(t) ?? "",
    restore: (body, replyTo) => {
      page.text = body;
      page.replyToId = replyTo;
      page.drafts.set(thread, body);
    },
    saveDraft: (t, body) => page.drafts.set(t, body),
    keepFailed: (f) => page.failed.push(f),
    newKey: () => `k${page.failed.length + 1}`,
  });
  return { page, io, fail: (r: SendMessageResult = "failed") => release(r) };
}

test("failed send: B typed while A was in flight -- B stays, A is kept to retry", async () => {
  const { page, io, fail } = harness();
  const sending = sendDmWithRecovery(io("message A", "msg-1"));
  assert.equal(page.text, "", "composer cleared on send");
  page.text = "message B"; // typed before the failure came back
  fail();
  const { result, outcome } = await sending;
  assert.equal(result, "failed");
  assert.equal(outcome, "keep");
  assert.equal(page.text, "message B", "newer draft not overwritten");
  assert.equal(page.replyToId, null);
  assert.deepEqual(page.failed.map((f) => [f.text, f.replyToId, f.objectionable]), [["message A", "msg-1", false]]);
});

test("failed send: a new reply picked while A was in flight -- the new reply stays", async () => {
  const { page, io, fail } = harness();
  const sending = sendDmWithRecovery(io("message A", "msg-1"));
  page.replyToId = "msg-7"; // swiped to reply to something else, nothing typed yet
  fail();
  assert.equal((await sending).outcome, "keep");
  assert.equal(page.replyToId, "msg-7", "newer reply target not replaced by A's");
  assert.equal(page.text, "", "A not dropped into the composer under the new reply");
  assert.equal(page.failed[0]?.replyToId, "msg-1", "A keeps its own reply target");
});

test("failed send: untouched composer -- A and its reply come back to edit", async () => {
  const { page, io, fail } = harness();
  const sending = sendDmWithRecovery(io("message A", "msg-1"));
  fail();
  assert.equal((await sending).outcome, "restore");
  assert.equal(page.text, "message A");
  assert.equal(page.replyToId, "msg-1");
  assert.equal(page.drafts.get("golfer-1"), "message A", "draft saved as well");
  assert.deepEqual(page.failed, []);
});

test("failed send: whitespace-only composer counts as empty", () => {
  assert.equal(failedSendOutcome({ threadId: "g", text: "  \n", replyToId: null }, "g", ""), "restore");
});

test("failed send: content filter -- kept, flagged so retry isn't offered", async () => {
  const { page, io, fail } = harness();
  const sending = sendDmWithRecovery(io("bad words", null));
  page.text = "sorry";
  fail("objectionable");
  const { result } = await sending;
  assert.equal(result, "objectionable");
  assert.equal(page.text, "sorry");
  assert.equal(page.failed[0]?.objectionable, true);
});

test("failed send: thread left meanwhile -- saved as that thread's draft only if it has none", async () => {
  const a = harness("golfer-1");
  const sendingA = sendDmWithRecovery(a.io("message A", "msg-1"));
  a.page.threadId = "golfer-2";
  a.page.text = "hi golfer 2";
  a.fail();
  assert.equal((await sendingA).outcome, "draft");
  assert.equal(a.page.drafts.get("golfer-1"), "message A");
  assert.equal(a.page.text, "hi golfer 2", "the other thread's composer untouched");

  const b = harness("golfer-1");
  const sendingB = sendDmWithRecovery(b.io("message A", null));
  b.page.mounted = false; // left the page entirely
  b.page.drafts.set("golfer-1", "newer saved draft");
  b.fail();
  assert.equal((await sendingB).outcome, "keep");
  assert.equal(b.page.drafts.get("golfer-1"), "newer saved draft", "newer saved draft wins");
});

test("successful send: nothing restored or kept", async () => {
  const { page, io, fail } = harness();
  const sending = sendDmWithRecovery(io("hello", null));
  page.text = "next";
  fail("sent");
  assert.deepEqual(await sending, { result: "sent", outcome: null });
  assert.equal(page.text, "next");
  assert.deepEqual(page.failed, []);
});

// Back: goBack reads React Router's history index.
function withHistoryIdx(idx: number | undefined, run: () => void) {
  const g = globalThis as { window?: unknown };
  const saved = g.window;
  g.window = { history: { state: idx === undefined ? null : { idx } } };
  try {
    run();
  } finally {
    g.window = saved;
  }
}

test("DM Back: opened from a push/link (no in-app history) goes to the Inbox", () => {
  for (const idx of [0, undefined]) {
    const calls: unknown[][] = [];
    withHistoryIdx(idx, () => goBack(((...a: unknown[]) => calls.push(a)) as never, "/messages"));
    assert.deepEqual(calls, [["/messages", { replace: true }]], `idx ${String(idx)}`);
  }
});

test("DM Back: with in-app history it goes back one page", () => {
  const calls: unknown[][] = [];
  withHistoryIdx(3, () => goBack(((...a: unknown[]) => calls.push(a)) as never, "/messages"));
  assert.deepEqual(calls, [[-1]]);
});

test("DM Back: header and golfer-not-found views both use goBack with the Inbox fallback", () => {
  const src = readFileSync(new URL("../src/pages/DirectMessageThread.tsx", import.meta.url), "utf8");
  assert.ok(!/navigate\(\s*-1\s*\)/.test(src), "no bare navigate(-1) left");
  const notFound = src.slice(src.indexOf("if (!other) {"), src.indexOf("const messagesById"));
  assert.match(notFound, /goBack\(navigate, "\/messages"\)/, "golfer-not-found view");
  const header = src.slice(src.indexOf("return (\n    <div className=\"flex flex-col gap-4 pb-6\">"));
  assert.match(header.slice(0, 600), /goBack\(navigate, "\/messages"\)/, "thread header Back");
});
