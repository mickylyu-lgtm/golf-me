// Run: npm run test:chat  (node --test, built-in type stripping)
// Ordering of my DM reaction writes (src/lib/reactionWrites.ts): one write
// in flight per message, the latest tap queued, no duplicate writes, no
// stale rollback, reset on account switch. Every test resolves requests by
// hand, deliberately trying the newer one first / the older one last.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReactionWriteQueue, type ReactionState } from "../src/lib/reactionWrites.ts";
import { isMissingReactionsTableError, overlayPendingReactions, type MessageReaction } from "../src/lib/reactions.ts";

const HEART = "❤️";
const LAUGH = "\u{1F602}";
const WOW = "\u{1F62E}";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Call {
  messageId: string;
  emoji: ReactionState;
  ok: () => void;
  fail: (error?: unknown) => void;
  done: boolean;
  signal: AbortSignal;
}

// A fake server that applies a write when it answers (what a client sees),
// plus what the page shows: the optimistic tap, then onSettled's state.
function setup(initial: ReactionState = null, timeoutMs?: number) {
  const queue = createReactionWriteQueue({ timeoutMs });
  const server = new Map<string, ReactionState>([["m1", initial]]);
  const shown = new Map<string, ReactionState>([["m1", initial]]);
  const calls: Call[] = [];
  const settled: [string, ReactionState][] = [];
  const uncertain: boolean[] = [];
  const late: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const write = (messageId: string, emoji: ReactionState, signal: AbortSignal) =>
    new Promise<unknown>((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const call: Call = {
        messageId,
        emoji,
        signal,
        done: false,
        ok: () => {
          assert.equal(call.done, false);
          call.done = true;
          inFlight -= 1;
          server.set(messageId, emoji);
          resolve(null);
        },
        fail: (error = { code: "500", message: "boom" }) => {
          assert.equal(call.done, false);
          call.done = true;
          inFlight -= 1;
          resolve(error);
        },
      };
      calls.push(call);
    });
  const tap = (emoji: ReactionState, messageId = "m1") => {
    const p = queue.set(messageId, emoji, {
      saved: shown.get(messageId) ?? null,
      write,
      onSettled: (id, saved, info) => {
        shown.set(id, saved);
        settled.push([id, saved]);
        uncertain.push(info.uncertain);
      },
      onLateSuccess: (id) => void late.push(id),
    });
    shown.set(messageId, emoji);
    return p;
  };
  const open = () => calls.filter((c) => !c.done);
  return { queue, server, shown, calls, settled, uncertain, late, tap, open, maxInFlight: () => maxInFlight };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Track promise outcomes without awaiting them.
function track(p: Promise<boolean>) {
  const r: { value?: boolean } = {};
  void p.then((v) => (r.value = v));
  return r;
}

test("control: without the queue, A then B with the older answer last ends on A", async () => {
  let server: ReactionState = null;
  const answers: (() => void)[] = [];
  const naive = (emoji: ReactionState) => new Promise<void>((resolve) => answers.push(() => ((server = emoji), resolve())));
  void naive(HEART);
  void naive(LAUGH);
  answers[1](); // newer first
  answers[0](); // older last
  assert.equal(server, HEART); // the bug this file guards against
});

test("add -> replace: the replace waits for the add; the latest tap ends on the server", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  assert.equal(h.open().length, 1, "only one write in flight");
  assert.equal(h.open()[0].emoji, HEART);
  assert.deepEqual([...h.queue.pending()], [["m1", LAUGH]]);
  h.open()[0].ok();
  await flush();
  assert.equal(h.open().length, 1);
  assert.equal(h.open()[0].emoji, LAUGH);
  assert.equal(h.shown.get("m1"), LAUGH, "no flicker back to the older tap");
  h.open()[0].ok();
  await flush();
  assert.equal(h.server.get("m1"), LAUGH);
  assert.equal(h.shown.get("m1"), LAUGH);
  assert.deepEqual(h.calls.map((c) => c.emoji), [HEART, LAUGH]);
  assert.deepEqual(h.settled, [["m1", LAUGH]]);
  assert.deepEqual([a.value, b.value], [true, true]);
  assert.equal(h.queue.pending().size, 0);
  assert.equal(h.maxInFlight(), 1);
});

test("add -> remove: the reaction doesn't reappear", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const r = track(h.tap(null));
  assert.equal(h.shown.get("m1"), null);
  h.open()[0].ok(); // the add lands on the server first
  await flush();
  assert.equal(h.shown.get("m1"), null, "still removed while the delete is in flight");
  assert.equal(h.open()[0].emoji, null);
  h.open()[0].ok();
  await flush();
  assert.equal(h.server.get("m1"), null);
  assert.deepEqual(h.settled, [["m1", null]]);
  assert.deepEqual([a.value, r.value], [true, true]);
});

test("replace -> remove -> add: the remove is coalesced away, the add is sent once", async () => {
  const h = setup(HEART);
  const a = track(h.tap(LAUGH));
  const b = track(h.tap(null));
  const c = track(h.tap(WOW));
  await flush();
  assert.equal(b.value, true, "replaced before it was sent: resolved, nothing to report");
  assert.equal(h.calls.length, 1);
  h.open()[0].ok();
  await flush();
  assert.equal(h.open()[0].emoji, WOW);
  h.open()[0].ok();
  await flush();
  assert.deepEqual(h.calls.map((x) => x.emoji), [LAUGH, WOW]);
  assert.equal(h.server.get("m1"), WOW);
  assert.equal(h.shown.get("m1"), WOW);
  assert.deepEqual([a.value, c.value], [true, true]);
});

test("no duplicate writes: add -> remove -> add while the add is in flight is one write", async () => {
  const h = setup();
  const p = [track(h.tap(HEART)), track(h.tap(null)), track(h.tap(HEART))];
  h.open()[0].ok();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.server.get("m1"), HEART);
  assert.deepEqual(h.settled, [["m1", HEART]]);
  assert.deepEqual(p.map((x) => x.value), [true, true, true]);
});

test("no write when the tap is what the server already has", async () => {
  const h = setup(HEART);
  assert.equal(await h.tap(HEART), true);
  assert.equal(h.calls.length, 0);
});

test("error on the OLDER request: the newer tap is still sent, no rollback, no toast once it saves", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  h.open()[0].fail();
  await flush();
  assert.equal(a.value, true, "superseded failure: no toast");
  assert.equal(h.shown.get("m1"), LAUGH, "not rolled back: a newer tap exists");
  assert.deepEqual(h.settled, []);
  assert.equal(h.open()[0].emoji, LAUGH);
  h.open()[0].ok();
  await flush();
  assert.equal(b.value, true);
  assert.equal(h.server.get("m1"), LAUGH);
  assert.deepEqual(h.settled, [["m1", LAUGH]]);
});

test("error on the older request when the newer tap equals the server state: nothing more sent", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const r = track(h.tap(null));
  h.open()[0].fail();
  await flush();
  assert.equal(h.calls.length, 1, "server still has none: no delete needed");
  assert.deepEqual(h.settled, [["m1", null]]);
  assert.deepEqual([a.value, r.value], [true, true], "the latest intent (none) is what the server has: no toast");
});

test("error on the NEWER request: rolls back to the last saved state, not the stale pre-tap one", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  h.open()[0].ok();
  await flush();
  h.open()[0].fail();
  await flush();
  assert.equal(h.server.get("m1"), HEART);
  assert.equal(h.shown.get("m1"), HEART, "rolled back to the saved heart");
  assert.deepEqual(h.settled, [["m1", HEART]]);
  assert.deepEqual([a.value, b.value], [true, false]);
});

test("error on a newer remove: the saved reaction comes back", async () => {
  const h = setup();
  track(h.tap(HEART));
  const r = track(h.tap(null));
  h.open()[0].ok();
  await flush();
  h.open()[0].fail();
  await flush();
  assert.equal(h.shown.get("m1"), HEART);
  assert.equal(r.value, false);
});

test("retry after a failure starts a fresh write and saves", async () => {
  const h = setup();
  const first = track(h.tap(HEART));
  h.open()[0].fail();
  await flush();
  assert.equal(first.value, false);
  assert.equal(h.shown.get("m1"), null, "rolled back: no newer tap");
  const again = track(h.tap(HEART));
  assert.equal(h.open().length, 1);
  h.open()[0].ok();
  await flush();
  assert.equal(again.value, true);
  assert.equal(h.server.get("m1"), HEART);
  assert.deepEqual(h.settled, [["m1", null], ["m1", HEART]]);
});

test("add -> remove -> add with the add failing: rolled back, then a retry works", async () => {
  const h = setup();
  const p = [track(h.tap(HEART)), track(h.tap(null)), track(h.tap(HEART))];
  h.open()[0].fail();
  await flush();
  assert.deepEqual(p.map((x) => x.value), [true, true, false], "one toast, from the latest tap");
  assert.equal(h.shown.get("m1"), null);
  assert.equal(h.calls.length, 1);
  const retry = track(h.tap(HEART));
  h.open()[0].ok();
  await flush();
  assert.equal(retry.value, true);
  assert.equal(h.server.get("m1"), HEART);
});

test("a rejected or throwing write counts as a failure", async () => {
  const queue = createReactionWriteQueue();
  const settled: ReactionState[] = [];
  const onSettled = (_: string, s: ReactionState) => void settled.push(s);
  assert.equal(await queue.set("m1", HEART, { saved: null, write: () => Promise.reject(new Error("offline")), onSettled }), false);
  assert.equal(
    await queue.set("m2", HEART, {
      saved: null,
      write: () => {
        throw new Error("sync");
      },
      onSettled,
    }),
    false,
  );
  assert.deepEqual(settled, [null, null]);
});

test("the database's uniform refusal is a failure (toast), not a missing table", async () => {
  const refusal = { code: "42501", message: "reaction_not_allowed", hint: "reaction_not_allowed", details: null };
  assert.equal(isMissingReactionsTableError(refusal), false, "reactions stay enabled");
  const queue = createReactionWriteQueue();
  assert.equal(await queue.set("m1", HEART, { saved: null, write: async () => refusal }), false);
});

test("messages are independent: one in flight per message, not per user", async () => {
  const h = setup();
  h.shown.set("m2", null);
  track(h.tap(HEART, "m1"));
  track(h.tap(LAUGH, "m2"));
  assert.equal(h.open().length, 2);
  assert.deepEqual(h.open().map((c) => c.messageId), ["m1", "m2"]);
});

test("refetch / realtime under reordering: a stale or intermediate fetch can't clobber the pending tap", async () => {
  const h = setup();
  const other: MessageReaction = { messageId: "m1", userId: "them", emoji: WOW };
  track(h.tap(HEART));
  track(h.tap(LAUGH));
  // A fetch that ran before anything was saved...
  const stale = overlayPendingReactions([other], h.queue.pending(), "me");
  assert.deepEqual(stale, [other, { messageId: "m1", userId: "me", emoji: LAUGH }]);
  h.open()[0].ok();
  await flush();
  // ...and a realtime echo of the intermediate heart while the laugh is in flight.
  const echo = overlayPendingReactions([other, { messageId: "m1", userId: "me", emoji: HEART }], h.queue.pending(), "me");
  assert.deepEqual(echo, [other, { messageId: "m1", userId: "me", emoji: LAUGH }]);
  h.open()[0].ok();
  await flush();
  assert.equal(h.queue.pending().size, 0, "settled: fetched rows are shown as they are");
});

test("reset (account switch): nothing queued is sent, late answers are ignored, no stale toast", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  h.queue.reset();
  await flush();
  assert.deepEqual([a.value, b.value], [true, true], "resolved quietly");
  assert.equal(h.queue.pending().size, 0);
  // The next account taps the same message id (can't happen for real, but
  // proves no state carries over): a fresh write right away.
  h.shown.set("m1", null);
  const next = track(h.tap(WOW));
  assert.equal(h.open().length, 2);
  h.open()[0].ok(); // the previous account's heart answers late
  await flush();
  assert.deepEqual(h.settled, [], "ignored");
  assert.equal(h.calls.length, 2, "the queued laugh was never sent");
  h.open()[0].ok();
  await flush();
  assert.equal(next.value, true);
  assert.deepEqual(h.settled, [["m1", WOW]]);
});

// ---- toast only for the latest intent ----

test("toast: older and newer both fail -> exactly one toast, from the newer tap", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  h.open()[0].fail();
  await flush();
  h.open()[0].fail();
  await flush();
  assert.deepEqual([a.value, b.value], [true, false]);
  assert.equal(h.shown.get("m1"), null, "rolled back to the confirmed state");
});

test("toast: the latest intent failing reports even when an older write saved", async () => {
  const h = setup();
  const a = track(h.tap(HEART));
  const b = track(h.tap(null));
  h.open()[0].ok();
  await flush();
  h.open()[0].fail();
  await flush();
  assert.deepEqual([a.value, b.value], [true, false]);
});

// ---- timeouts (timeoutMs shortened to 20 ms) ----

test("timeout: a hung request fails after the bound, is aborted, rolls back and asks for a refetch", async () => {
  const h = setup(null, 20);
  const a = track(h.tap(HEART));
  await sleep(5);
  assert.equal(a.value, undefined, "still waiting before the bound");
  await sleep(40);
  assert.equal(a.value, false, "latest intent timed out: toast");
  assert.equal(h.calls[0].signal.aborted, true, "request aborted");
  assert.deepEqual(h.settled, [["m1", null]]);
  assert.deepEqual(h.uncertain, [true], "caller refetches instead of trusting the rollback");
  assert.equal(h.queue.pending().size, 0);
});

test("timeout then late success: no state change from the queue, onLateSuccess asks for a refetch", async () => {
  const h = setup(null, 20);
  track(h.tap(HEART));
  await sleep(40);
  h.calls[0].ok(); // the server applied it after all, and the answer got through
  await flush();
  assert.deepEqual(h.late, ["m1"]);
  assert.deepEqual(h.settled, [["m1", null]], "settled once, at the timeout");
  assert.equal(h.calls.length, 1, "nothing re-sent");
  // The refetch then shows the heart; a new tap starts from it normally.
  h.shown.set("m1", HEART);
  const r = track(h.tap(null));
  assert.equal(h.open().at(-1)?.emoji, null);
  h.open().at(-1)?.ok();
  await flush();
  assert.equal(r.value, true);
  assert.equal(h.server.get("m1"), null);
});

test("timeout with a newer intent queued: the newer one is sent even if it matches the old confirmed state", async () => {
  const h = setup(null, 20);
  const a = track(h.tap(HEART)); // hangs
  const b = track(h.tap(null)); // back to none: normally no write needed
  while (h.calls.length < 2) await sleep(1);
  await flush();
  assert.equal(a.value, true, "superseded: no toast");
  assert.equal(h.calls.length, 2, "server state unknown after a timeout: the delete IS sent");
  assert.equal(h.calls[1].emoji, null);
  assert.equal(h.shown.get("m1"), null, "no rollback in between");
  h.calls[1].ok();
  await flush();
  assert.equal(b.value, true);
  assert.deepEqual(h.settled, [["m1", null]]);
  assert.deepEqual(h.uncertain, [false], "a later confirmed write makes it certain again");
  h.calls[0].ok(); // the hung heart answers very late
  await flush();
  assert.deepEqual(h.late, ["m1"], "caller refetches and shows what the server really has");
});

test("after an uncertain settle, a tap matching what's shown is still sent (a late request may land); a confirmed write clears it", async () => {
  const h = setup(null, 20);
  track(h.tap(HEART)); // hangs, times out
  await sleep(40);
  assert.deepEqual(h.uncertain, [true]);
  assert.equal(h.shown.get("m1"), null);
  const again = track(h.tap(null)); // same as shown: normally no write
  assert.equal(h.calls.length, 2, "sent anyway: its newer sequence beats the late heart");
  h.calls[1].ok();
  await flush();
  assert.equal(again.value, true);
  assert.equal(await h.tap(null), true);
  assert.equal(h.calls.length, 2, "certain again: no write needed");
});

test("timeout with a newer intent queued that also fails: one toast, uncertain settle", async () => {
  const h = setup(null, 20);
  const a = track(h.tap(HEART));
  const b = track(h.tap(LAUGH));
  await sleep(40);
  h.calls[1].fail();
  await flush();
  assert.deepEqual([a.value, b.value], [true, false]);
  assert.deepEqual(h.uncertain, [true]);
});

test("reset aborts the in-flight request", async () => {
  const h = setup();
  track(h.tap(HEART));
  h.queue.reset();
  assert.equal(h.calls[0].signal.aborted, true);
});

// Mocked timing: random taps, random answer delays (often newer-first),
// random failures. Invariants hold for every seed.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test("mocked timing: 300 random runs keep one in flight, no duplicate writes, the latest tap wins", async () => {
  const OPTIONS: ReactionState[] = [null, HEART, LAUGH, WOW];
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = rng(seed);
    const queue = createReactionWriteQueue();
    let server: ReactionState = null;
    let shown: ReactionState = null;
    let inFlight = 0;
    let failures = 0;
    const writes: [ReactionState, ReactionState][] = []; // [server before, written]
    const write = (_: string, emoji: ReactionState) =>
      new Promise<unknown>((resolve) => {
        inFlight += 1;
        assert.ok(inFlight <= 1, `seed ${seed}: two writes in flight`);
        writes.push([server, emoji]);
        const fail = rand() < 0.25;
        setTimeout(() => {
          inFlight -= 1;
          if (fail) {
            failures += 1;
            resolve({ message: "boom" });
          } else {
            server = emoji;
            resolve(null);
          }
        }, Math.floor(rand() * 6));
      });
    const results: Promise<boolean>[] = [];
    let last: ReactionState = null;
    const taps = 1 + Math.floor(rand() * 6);
    for (let i = 0; i < taps; i += 1) {
      last = OPTIONS[Math.floor(rand() * OPTIONS.length)];
      results.push(queue.set("m1", last, { saved: shown, write, onSettled: (_, s) => void (shown = s) }));
      shown = last;
      if (rand() < 0.5) await new Promise((r) => setTimeout(r, Math.floor(rand() * 4)));
    }
    await Promise.all(results);
    await flush();
    assert.equal(queue.pending().size, 0, `seed ${seed}: settled`);
    assert.equal(shown, server, `seed ${seed}: shown = what the server has`);
    for (const [before, written] of writes) assert.notEqual(before, written, `seed ${seed}: duplicate write`);
    if (failures === 0) assert.equal(server, last, `seed ${seed}: latest tap wins`);
  }
});
