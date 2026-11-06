// Run: npm run test:chat  (node --test, built-in type stripping)
// Server-side ordering of DM reaction writes (src/lib/reactionOrder.ts with
// the queue from src/lib/reactionWrites.ts), against a simulated server that
// implements migration 20261106160000 (or the old table, `ordered: false`)
// and a simulated network where a request can ARRIVE after the client gave
// up on it: the late-write race the migration closes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReactionSeqClock,
  isMissingClientSeqError,
  isReactionRefusal,
  reactionSeqFromRow,
  rowsShowOrdering,
  sendReactionWrite,
  type OrderingSupport,
  type ReactionTransport,
  type ReactionUpsertRow,
} from "../src/lib/reactionOrder.ts";
import { createReactionWriteQueue, type ReactionState } from "../src/lib/reactionWrites.ts";
import { isMissingReactionsTableError, overlayPendingReactions, reactionRowsToReactions } from "../src/lib/reactions.ts";

const HEART = "❤️";
const LAUGH = "\u{1F602}";
const WOW = "\u{1F62E}";
const ME = "me";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MISSING_COLUMN = { code: "PGRST204", message: "Could not find the 'client_seq' column of 'message_reactions' in the schema cache" };
const REFUSED = { code: "42501", message: "reaction_not_allowed", hint: "reaction_not_allowed" };

// ---- simulated server ----
interface Row {
  emoji: ReactionState;
  seq: number | null;
}
function createServer(ordered: boolean) {
  const rows = new Map<string, Row>();
  const refused = new Set<string>(); // messages where inserts/updates are refused (block, unsent...)
  const failNext: unknown[] = [];
  const log: string[] = [];
  return {
    rows,
    refused,
    failNext,
    log,
    ordered,
    upsert(row: ReactionUpsertRow): unknown {
      if (failNext.length) return failNext.shift();
      if (!ordered && row.client_seq !== undefined) return MISSING_COLUMN;
      if (!ordered && row.emoji === null) return { code: "23502", message: "null value in column \"emoji\"" };
      if (refused.has(row.message_id)) return REFUSED;
      const old = rows.get(row.message_id);
      const seq = row.client_seq ?? null;
      if (old && ordered && seq !== null && old.seq !== null && seq < old.seq) {
        log.push(`ignored ${row.emoji}@${seq}`);
        return null; // stale: 0 rows, no error
      }
      rows.set(row.message_id, { emoji: row.emoji, seq: seq ?? old?.seq ?? null });
      log.push(`applied ${row.emoji}@${seq}`);
      return null;
    },
    remove(messageId: string): unknown {
      if (failNext.length) return failNext.shift();
      rows.delete(messageId);
      log.push("deleted");
      return null;
    },
    shown(messageId = "m1"): ReactionState {
      return rows.get(messageId)?.emoji ?? null;
    },
  };
}
type Server = ReturnType<typeof createServer>;

// ---- simulated network: each request arrives and answers when told ----
interface Req {
  kind: "upsert" | "remove";
  label: string;
  arrive: () => void; // the server executes it now
  answer: () => void; // the client hears back now (after arriving)
  arrived: boolean;
  answered: boolean;
}
function createNetwork(server: Server) {
  const reqs: Req[] = [];
  const make = (kind: Req["kind"], label: string, exec: () => unknown, signal: AbortSignal) =>
    new Promise<unknown>((resolve) => {
      let result: unknown = undefined;
      const req: Req = {
        kind,
        label,
        arrived: false,
        answered: false,
        arrive: () => {
          assert.equal(req.arrived, false);
          req.arrived = true;
          result = exec();
        },
        answer: () => {
          if (!req.arrived) req.arrive();
          if (req.answered) return;
          req.answered = true;
          resolve(result);
        },
      };
      // fetch() rejects at once on abort; the request may still reach the server later.
      signal.addEventListener("abort", () => {
        if (!req.answered) {
          req.answered = true;
          resolve({ name: "AbortError", message: "aborted" });
        }
      });
      reqs.push(req);
    });
  const transport: ReactionTransport = {
    upsert: (row, signal) => make("upsert", `${row.emoji}@${row.client_seq ?? "-"}`, () => server.upsert(row), signal),
    remove: (messageId, signal) => make("remove", "delete", () => server.remove(messageId), signal),
  };
  return { reqs, transport, open: () => reqs.filter((r) => !r.answered) };
}

// The context's wiring: queue + sendReactionWrite + clock + ordering state.
function setup(opts: { ordered: boolean; support?: OrderingSupport; timeoutMs?: number; now?: () => number }) {
  const server = createServer(opts.ordered);
  const net = createNetwork(server);
  const queue = createReactionWriteQueue({ timeoutMs: opts.timeoutMs ?? 50 });
  const clock = createReactionSeqClock();
  const ordering = { support: opts.support ?? "unknown" };
  let t = 1_700_000_000_000;
  const now = opts.now ?? (() => t++);
  let shown: ReactionState = null;
  const settled: { saved: ReactionState; uncertain: boolean }[] = [];
  const late: string[] = [];
  const ctx = { transport: net.transport, clock, ordering, userId: ME, now };
  const tap = (emoji: ReactionState, messageId = "m1") => {
    const p = queue.set(messageId, emoji, {
      saved: shown,
      write: (id, e, signal) => sendReactionWrite(ctx, id, e, signal),
      onSettled: (_, saved, info) => {
        shown = saved;
        settled.push({ saved, uncertain: info.uncertain });
      },
      onLateSuccess: (id) => void late.push(id),
    });
    shown = emoji;
    return p;
  };
  return { server, net, queue, clock, ordering, ctx, tap, settled, late, shown: () => shown, setShown: (s: ReactionState) => (shown = s) };
}
function track(p: Promise<boolean>) {
  const r: { value?: boolean } = {};
  void p.then((v) => (r.value = v));
  return r;
}

// ---- the race, reproduced and closed ----

for (const ordered of [false, true]) {
  const name = ordered ? "WITH ordering" : "control, old table";
  test(`${name}: add times out, remove saves, then the add ARRIVES late`, async () => {
    const h = setup({ ordered, support: ordered ? "yes" : "no", timeoutMs: 20 });
    track(h.tap(HEART)); // R1 hangs in the network
    const r = track(h.tap(null));
    while (h.net.reqs.length < 2) await sleep(1); // R1 timed out; R2 sent
    assert.equal(h.net.reqs.length, 2);
    h.net.reqs[1].answer(); // remove arrives + saves
    await flush();
    assert.equal(r.value, true);
    h.net.reqs[0].arrive(); // the timed-out add reaches the server only now
    if (ordered) {
      assert.equal(h.server.shown(), null, "late add ignored: no resurrection");
      assert.match(h.server.log.join(), /ignored ❤️/);
    } else {
      assert.equal(h.server.shown(), HEART, "reproduced: the reaction comes back");
    }
  });

  test(`${name}: replace times out, a newer replace saves, then the old one arrives late`, async () => {
    const h = setup({ ordered, support: ordered ? "yes" : "no", timeoutMs: 20 });
    track(h.tap(HEART));
    track(h.tap(LAUGH));
    while (h.net.reqs.length < 2) await sleep(1);
    h.net.reqs[1].answer();
    await flush();
    h.net.reqs[0].arrive();
    assert.equal(h.server.shown(), ordered ? LAUGH : HEART);
  });
}

test("replace -> remove -> add with two timeouts, arriving in reverse: the latest tap wins", async () => {
  const h = setup({ ordered: true, support: "yes", timeoutMs: 20 });
  track(h.tap(LAUGH)); // R1 hangs
  track(h.tap(null));
  await sleep(40); // R1 timed out, R2 (tombstone) sent and hangs
  track(h.tap(WOW));
  while (h.net.reqs.length < 3) await sleep(1); // R2 timed out, R3 sent
  assert.equal(h.net.reqs.length, 3);
  h.net.reqs[2].answer();
  await flush();
  h.net.reqs[1].arrive();
  h.net.reqs[0].arrive();
  assert.equal(h.server.shown(), WOW);
  assert.equal(h.server.rows.get("m1")?.seq !== null, true);
  assert.equal(h.settled.at(-1)?.saved, WOW, JSON.stringify({ reqs: h.net.reqs.map((r) => r.label), settled: h.settled }));
});

test("rapid add / replace / remove with out-of-order answers: one in flight, increasing sequences", async () => {
  const h = setup({ ordered: true, support: "yes" });
  const p = [track(h.tap(HEART)), track(h.tap(LAUGH)), track(h.tap(null)), track(h.tap(WOW))];
  assert.equal(h.net.open().length, 1);
  h.net.open()[0].answer();
  await flush();
  assert.equal(h.net.open().length, 1, "LAUGH and null coalesced into WOW");
  h.net.open()[0].answer();
  await flush();
  const seqs = h.net.reqs.map((r) => Number(r.label.split("@")[1]));
  assert.ok(seqs[1] > seqs[0], "sequence increases");
  assert.equal(h.server.shown(), WOW);
  assert.deepEqual(p.map((x) => x.value), [true, true, true, true]);
});

test("timeout then late SUCCESS answer: refetch requested, server and sequence consistent", async () => {
  const h = setup({ ordered: true, support: "yes", timeoutMs: 20 });
  const a = track(h.tap(HEART));
  // Arrives at the server in time, but the answer is lost/slow.
  h.net.reqs[0].arrive();
  await sleep(40);
  assert.equal(a.value, false, "latest intent timed out: toast");
  assert.equal(h.settled[0].uncertain, true, "caller refetches");
  assert.equal(h.server.shown(), HEART, "the server did apply it (the refetch will show it)");
  // Aborted fetch already answered with AbortError, so no late success here;
  // a transport that ignores abort would answer later:
  const h2 = setup({ ordered: true, support: "yes", timeoutMs: 20 });
  const slow: ReactionTransport = {
    upsert: (row) => new Promise((resolve) => setTimeout(() => resolve(h2.server.upsert(row)), 60)),
    remove: (id) => Promise.resolve(h2.server.remove(id)),
  };
  h2.ctx.transport = slow;
  track(h2.tap(HEART));
  await sleep(100);
  assert.deepEqual(h2.late, ["m1"], "late success: refetch again");
  assert.equal(h2.server.shown(), HEART);
});

test("failure, then retry: the retry carries a higher sequence and saves; no automatic retry", async () => {
  const h = setup({ ordered: true, support: "yes" });
  h.server.failNext.push({ code: "500", message: "boom" });
  const a = track(h.tap(HEART));
  h.net.open()[0].answer();
  await flush();
  assert.equal(a.value, false);
  assert.equal(h.net.reqs.length, 1, "one request, no retry loop");
  assert.equal(h.shown(), null, "rolled back");
  const b = track(h.tap(HEART));
  h.net.open()[0].answer();
  await flush();
  assert.equal(b.value, true);
  assert.equal(h.server.shown(), HEART);
  const [s1, s2] = h.net.reqs.map((r) => Number(r.label.split("@")[1]));
  assert.ok(s2 > s1);
});

test("realtime echo / other device: fetched stored sequence keeps my next write above it", async () => {
  const h = setup({ ordered: true, support: "yes" });
  // Another device of mine wrote with a sequence far above this clock.
  const FUTURE = 9_000_000_000_000_000;
  h.server.rows.set("m1", { emoji: LAUGH, seq: FUTURE });
  // The realtime-triggered refetch returns that row (with client_seq) while my tap is pending.
  const fetched = [{ message_id: "m1", user_id: ME, emoji: LAUGH, client_seq: FUTURE }];
  assert.equal(rowsShowOrdering(fetched), true);
  h.clock.observe("m1", reactionSeqFromRow(fetched[0]) ?? 0);
  h.setShown(LAUGH);
  const p = track(h.tap(null));
  // The echo can't undo the pending tap (overlay):
  assert.deepEqual(overlayPendingReactions(reactionRowsToReactions(fetched), h.queue.pending(), ME), []);
  h.net.open()[0].answer();
  await flush();
  assert.equal(p.value, true);
  assert.equal(h.server.shown(), null, "applied: my sequence is above the observed one");
});

test("trade-off (documented): a write from a device whose clock is behind, without having fetched the newer row, is ignored; the refetch shows the server", async () => {
  const h = setup({ ordered: true, support: "yes" });
  h.server.rows.set("m1", { emoji: LAUGH, seq: 9_000_000_000_000_000 });
  track(h.tap(HEART));
  h.net.open()[0].answer();
  await flush();
  assert.equal(h.server.shown(), LAUGH, "ignored silently, no error, no retry");
  assert.equal(h.net.reqs.length, 1);
});

test("account change: clock and ordering state start fresh; the old account's in-flight write can't touch them", async () => {
  const h = setup({ ordered: true, support: "yes" });
  h.clock.observe("m1", 8_000_000_000_000_000);
  const oldOrdering = h.ordering;
  track(h.tap(HEART));
  h.queue.reset();
  h.clock.reset();
  const fresh = { support: "unknown" as OrderingSupport };
  assert.notEqual(fresh, oldOrdering);
  const seq = h.clock.next("m1", 1_700_000_000_000);
  assert.ok(seq < 8_000_000_000_000_000, "the previous account's observed sequence is gone");
  h.net.reqs[0].answer(); // aborted by reset already; nothing changes
  await flush();
  assert.equal(h.settled.length, 0);
});

// ---- rollout fallbacks (bounded) ----

test("migration NOT applied: first write is retried once the old way and ordering is off; later writes go old-way directly", async () => {
  const h = setup({ ordered: false, support: "unknown" });
  const a = track(h.tap(HEART));
  h.net.open()[0].answer(); // sequenced: PGRST204 client_seq
  await flush();
  assert.equal(h.ordering.support, "no");
  assert.equal(h.net.reqs.length, 2);
  assert.equal(h.net.reqs[1].label, `${HEART}@-`, "retried without client_seq");
  h.net.open()[0].answer();
  await flush();
  assert.equal(a.value, true);
  const r = track(h.tap(null));
  assert.equal(h.net.open()[0].kind, "remove", "old DELETE, one request");
  h.net.open()[0].answer();
  await flush();
  assert.equal(r.value, true);
  assert.equal(h.net.reqs.length, 3);
  assert.equal(h.server.shown(), null);
});

test("migration applied: a removal is a tombstone upsert (no DELETE), ordering marked supported", async () => {
  const h = setup({ ordered: true, support: "unknown" });
  track(h.tap(HEART));
  h.net.open()[0].answer();
  await flush();
  track(h.tap(null));
  assert.equal(h.net.open()[0].kind, "upsert");
  assert.match(h.net.open()[0].label, /^null@\d+$/);
  h.net.open()[0].answer();
  await flush();
  assert.equal(h.ordering.support, "yes");
  assert.equal(h.server.rows.get("m1")?.emoji, null, "row kept as tombstone");
});

test("refused tombstone (block / unsent): falls back ONCE to DELETE; a refused add is not retried", async () => {
  const h = setup({ ordered: true, support: "yes" });
  h.server.rows.set("m1", { emoji: HEART, seq: 1 });
  h.setShown(HEART);
  h.server.refused.add("m1");
  const r = track(h.tap(null));
  h.net.open()[0].answer();
  await flush();
  assert.equal(h.net.open()[0].kind, "remove");
  h.net.open()[0].answer();
  await flush();
  assert.equal(r.value, true);
  assert.equal(h.server.shown(), null);
  const a = track(h.tap(HEART));
  h.net.open()[0].answer();
  await flush();
  assert.equal(a.value, false, "toast");
  assert.equal(h.net.reqs.length, 3, "no retry of a refused add");
});

test("no fallback after an abort", async () => {
  const server = createServer(false);
  const net = createNetwork(server);
  const controller = new AbortController();
  const ordering = { support: "unknown" as OrderingSupport };
  const p = sendReactionWrite({ transport: net.transport, clock: createReactionSeqClock(), ordering, userId: ME, now: Date.now }, "m1", HEART, controller.signal);
  controller.abort();
  const error = await p;
  assert.equal((error as { name?: string }).name, "AbortError");
  assert.equal(net.reqs.length, 1);
  assert.equal(ordering.support, "unknown");
});

// ---- clock + helpers ----

test("clock: strictly increasing within the same millisecond, across messages, and after a reload (new clock, later time)", () => {
  const c = createReactionSeqClock();
  const a = c.next("m1", 1_700_000_000_000);
  const b = c.next("m2", 1_700_000_000_000);
  const d = c.next("m1", 1_699_999_999_000); // clock stepped back
  assert.ok(b > a && d > b);
  const reloaded = createReactionSeqClock();
  assert.ok(reloaded.next("m1", 1_700_000_000_001) > a);
  c.observe("m3", 5_000_000_000_000_000);
  assert.equal(c.next("m3", 1_700_000_000_000), 5_000_000_000_000_001);
  c.observe("m3", Number.NaN);
  c.observe("m3", -4);
  assert.ok(Number.isSafeInteger(c.next("m3", Date.now())));
  assert.ok(Number.isSafeInteger(Math.floor(Date.UTC(2200, 0, 1) * 1000)), "µs stay below 2^53 for centuries");
});

test("helpers: error classification and row parsing", () => {
  assert.equal(isMissingClientSeqError(MISSING_COLUMN), true);
  assert.equal(isMissingClientSeqError({ code: "42703", message: 'column "client_seq" does not exist' }), true);
  assert.equal(isMissingClientSeqError({ code: "PGRST204", message: "Could not find the 'other' column" }), false);
  assert.equal(isMissingReactionsTableError(MISSING_COLUMN), false, "a missing column must not hide reactions");
  assert.equal(isMissingReactionsTableError({ code: "PGRST205", message: "Could not find the table 'public.message_reactions' in the schema cache" }), true);
  assert.equal(isReactionRefusal(REFUSED), true);
  assert.equal(isReactionRefusal({ code: "500" }), false);
  assert.equal(reactionSeqFromRow({ client_seq: 12 }), 12);
  assert.equal(reactionSeqFromRow({ client_seq: "12" }), 12);
  assert.equal(reactionSeqFromRow({ client_seq: null }), null);
  assert.equal(reactionSeqFromRow({}), null);
  assert.equal(rowsShowOrdering([{ message_id: "m", user_id: "u", emoji: HEART }]), false);
  // Tombstones never become pills.
  assert.deepEqual(reactionRowsToReactions([{ message_id: "m1", user_id: ME, emoji: null, client_seq: 3 }]), []);
});

// ---- random timing with late arrivals ----

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function randomRun(seed: number, ordered: boolean) {
  const rand = rng(seed);
  const h = setup({ ordered, support: ordered ? "yes" : "no", timeoutMs: 8 });
  const OPTIONS: ReactionState[] = [null, HEART, LAUGH, WOW];
  const arrivals: Promise<void>[] = [];
  const pump = setInterval(() => {
    for (const r of h.net.reqs) {
      if ((r as Req & { scheduled?: boolean }).scheduled) continue;
      (r as Req & { scheduled?: boolean }).scheduled = true;
      const arriveAt = Math.floor(rand() * 20); // often past the 8 ms timeout
      const answerAt = arriveAt + Math.floor(rand() * 4);
      arrivals.push(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            if (!r.arrived) r.arrive();
            setTimeout(() => {
              r.answer();
              resolve();
            }, answerAt - arriveAt);
          }, arriveAt),
        ),
      );
    }
  }, 1);
  const results: Promise<boolean>[] = [];
  let last: ReactionState = null;
  const taps = 2 + Math.floor(rand() * 5);
  for (let i = 0; i < taps; i += 1) {
    last = OPTIONS[Math.floor(rand() * OPTIONS.length)];
    results.push(h.tap(last));
    await sleep(Math.floor(rand() * 12));
  }
  await Promise.all(results);
  await sleep(5);
  while (arrivals.length < h.net.reqs.length) await sleep(2);
  await Promise.all(arrivals);
  clearInterval(pump);
  return { server: h.server.shown(), last, settledLast: h.settled.at(-1)?.saved, reqs: h.net.reqs.length };
}

test("mocked timing: 150 random runs with late arrivals; with ordering the server always ends on the latest tap", async () => {
  let legacyWrong = 0;
  for (let seed = 1; seed <= 150; seed += 1) {
    const r = await randomRun(seed, true);
    assert.equal(r.server, r.last, `seed ${seed}: server ${r.server} vs last tap ${r.last}`);
    const control = await randomRun(seed, false);
    if (control.server !== control.last) legacyWrong += 1;
  }
  assert.ok(legacyWrong > 0, "control: without ordering some runs end on an older tap");
});
