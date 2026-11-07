// Run: node --test tests/postMediaLedger.test.ts  (built-in type stripping)
//
// CreatePost's photo/video slots (src/lib/postMediaLedger.ts). The page
// below mirrors CreatePost's wiring: React state that only updates on a
// "render" (flush), the ledger consulted synchronously at every action, and
// uploads that resolve when the test says so (deferred promises).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostMediaLedger, insertBySeq, isPostMediaCapError, uploadIntoSlots, type MediaSlot } from "../src/lib/postMediaLedger.ts";

test("the server's cap refusal is recognised by code + hint only", () => {
  // Shape of a PostgREST error from migration 20261107260000.
  assert.equal(isPostMediaCapError({ code: "23514", hint: "community_post_media_cap", message: "A post can have at most 10 photos or videos." }), true);
  assert.equal(isPostMediaCapError({ code: "23514", hint: null, message: "other check" }), false);
  assert.equal(isPostMediaCapError({ code: "P0001", hint: "community_post_media_cap" }), false);
  assert.equal(isPostMediaCapError(new Error("community_post_media_cap")), false);
  assert.equal(isPostMediaCapError(null), false);
});

const CAP = 10;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

interface Item {
  id: string;
  url: string;
}

function page(initial: Item[] = []) {
  let n = 0;
  const ledger = createPostMediaLedger(
    CAP,
    initial.map((m) => m.id),
    () => `slot-${++n}`,
  );
  // Rendered state, and updates queued until the next render.
  let items = [...initial];
  let pendingUploads = 0;
  const queue: Array<() => void> = [];
  const uploads = new Map<string, ReturnType<typeof deferred<Omit<Item, "id">>>>();
  const failed: string[] = [];
  const toasts: string[] = [];
  const published: Item[][] = [];
  const batches: Promise<void>[] = [];

  function flush() {
    while (queue.length) queue.shift()!();
  }

  return {
    ledger,
    get items() {
      return items;
    },
    get pendingUploads() {
      return pendingUploads;
    },
    failed,
    toasts,
    published,
    flush,
    /** CreatePost.doAttachMedia: reserve synchronously, then upload one by one. */
    attach(names: string[]) {
      const slots = ledger.reserve(names.length);
      if (slots.length === 0) {
        toasts.push("full");
        return [] as MediaSlot[];
      }
      if (slots.length < names.length) toasts.push(`only ${slots.length}`);
      const p = ledger.pending;
      queue.push(() => (pendingUploads = p));
      batches.push(
        uploadIntoSlots<string, Item>({
          ledger,
          batch: slots.map((slot, i) => ({ file: names[i], slot })),
          upload: (name) => {
            const d = deferred<Omit<Item, "id">>();
            uploads.set(name, d);
            return d.promise;
          },
          onCommitted: (item) => queue.push(() => (items = insertBySeq(items, item, ledger.seqOf))),
          onFailed: (name) => failed.push(name),
          onChange: () => {
            const now = ledger.pending;
            queue.push(() => (pendingUploads = now));
          },
        }),
      );
      return slots;
    },
    async finish(name: string) {
      await tick();
      const d = uploads.get(name);
      assert.ok(d, `upload ${name} started`);
      d.resolve({ url: `https://cdn/${name}` });
      await tick();
    },
    async fail(name: string) {
      await tick();
      const d = uploads.get(name);
      assert.ok(d, `upload ${name} started`);
      d.reject(new Error("network"));
      await tick();
    },
    started(name: string) {
      return uploads.has(name);
    },
    remove(id: string) {
      ledger.remove(id);
      queue.push(() => (items = items.filter((m) => m.id !== id)));
    },
    replaceAll() {
      ledger.clear();
      queue.push(() => {
        items = [];
        pendingUploads = 0;
      });
    },
    /** CreatePost.handlePost's independent check, on the rendered snapshot. */
    publish(): string {
      if (ledger.pending > 0) return "pending";
      const block = ledger.publishBlock(items.map((m) => m.id));
      if (block) return block;
      published.push([...items]);
      return "published";
    },
    /** CreatePost's canPost (the button). */
    get canPost() {
      return pendingUploads === 0;
    },
    settle: () => Promise.all(batches),
  };
}

test("overlapping selections: the first finishing doesn't unblock publish while the second runs", async () => {
  const p = page();
  p.attach(["a"]);
  p.attach(["b"]);
  p.flush();
  assert.equal(p.pendingUploads, 2);
  await p.finish("a");
  p.flush();
  assert.equal(p.pendingUploads, 1, "a finishing must not clear b's in-flight state");
  assert.equal(p.canPost, false);
  assert.equal(p.publish(), "pending");
  await p.finish("b");
  p.flush();
  assert.equal(p.canPost, true);
  assert.equal(p.publish(), "published");
  assert.deepEqual(
    p.published[0].map((m) => m.url),
    ["https://cdn/a", "https://cdn/b"],
  );
});

test("overlapping selections completing in the other order keep pick order", async () => {
  const p = page();
  p.attach(["a"]);
  p.attach(["b"]);
  await p.finish("b");
  p.flush();
  assert.equal(p.publish(), "pending");
  await p.finish("a");
  p.flush();
  assert.equal(p.publish(), "published");
  assert.deepEqual(
    p.published[0].map((m) => m.url),
    ["https://cdn/a", "https://cdn/b"],
  );
});

test("rapid repeated picks before any render can't overbook (the 12-item repro is held to 10)", async () => {
  const p = page();
  // No flush in between: rendered state still shows 0 items, 0 uploading.
  p.attach(["1", "2", "3", "4", "5", "6"]);
  p.attach(["7", "8", "9", "10", "11", "12"]);
  assert.deepEqual(p.toasts, ["only 4"]);
  assert.equal(p.ledger.pending, 10);
  assert.equal(p.ledger.remaining, 0);
  assert.equal(p.attach(["13"]).length, 0);
  for (const name of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) await p.finish(name);
  assert.equal(p.started("11"), false);
  assert.equal(p.started("12"), false);
  p.flush();
  assert.equal(p.items.length, 10);
  assert.equal(p.publish(), "published");
});

test("exact cap and cap+1 boundaries", () => {
  const exact = page();
  assert.equal(exact.attach(Array.from({ length: CAP }, (_, i) => `f${i}`)).length, CAP);
  assert.deepEqual(exact.toasts, []);
  const over = page();
  assert.equal(over.attach(Array.from({ length: CAP + 1 }, (_, i) => `f${i}`)).length, CAP);
  assert.deepEqual(over.toasts, [`only ${CAP}`]);
});

test("mixed existing and pending items count together, with partial acceptance", async () => {
  const existing = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, url: `https://cdn/d${i}` }));
  const p = page(existing);
  assert.equal(p.ledger.remaining, 3);
  p.attach(["a", "b"]);
  assert.equal(p.ledger.remaining, 1);
  const slots = p.attach(["c", "d", "e"]);
  assert.equal(slots.length, 1);
  assert.deepEqual(p.toasts, ["only 1"]);
  await p.finish("a");
  await p.finish("b");
  await p.finish("c");
  p.flush();
  assert.equal(p.items.length, 10);
  assert.deepEqual(
    p.items.map((m) => m.id).slice(0, 7),
    existing.map((m) => m.id),
    "restored draft items stay first",
  );
  assert.equal(p.publish(), "published");
});

test("a failed upload releases its slot exactly once, and a retry works", async () => {
  const p = page();
  p.attach(Array.from({ length: CAP }, (_, i) => `f${i}`));
  await p.fail("f0");
  assert.deepEqual(p.failed, ["f0"]);
  assert.equal(p.ledger.remaining, 1);
  // Releasing again (any stale path) must not free a second slot.
  p.ledger.release({ id: "slot-1", seq: 0 });
  assert.equal(p.ledger.remaining, 1);
  for (let i = 1; i < CAP; i++) await p.finish(`f${i}`);
  assert.equal(p.ledger.pending, 0);
  assert.equal(p.ledger.remaining, 1);
  p.attach(["retry"]);
  await p.finish("retry");
  p.flush();
  assert.equal(p.items.length, CAP);
  assert.equal(p.ledger.pending, 0, "never negative");
  assert.equal(p.publish(), "published");
});

test("Replace while uploading: stale completions don't resurrect media or leak capacity", async () => {
  const p = page();
  p.attach(["a", "b"]);
  await p.finish("a");
  p.replaceAll();
  p.flush();
  assert.equal(p.ledger.remaining, CAP);
  // b was mid-upload when Replace ran; it finishes later.
  await p.finish("b");
  p.flush();
  assert.deepEqual(p.items, []);
  assert.equal(p.ledger.remaining, CAP);
  assert.equal(p.ledger.pending, 0);
  assert.equal(p.publish(), "published");
  assert.deepEqual(p.published[0], []);
});

test("a cancelled batch doesn't start its remaining uploads, and a stale failure isn't reported", async () => {
  const p = page();
  p.attach(["a", "b", "c"]);
  p.ledger.cancelPending(); // leaving the page
  await p.fail("a");
  assert.deepEqual(p.failed, []);
  await tick();
  assert.equal(p.started("b"), false);
  assert.equal(p.started("c"), false);
  await p.settle();
  assert.equal(p.ledger.pending, 0);
});

test("removing an item, then its id never comes back", async () => {
  const p = page();
  const [slotA] = p.attach(["a", "b"]);
  await p.finish("a");
  p.flush();
  p.remove(slotA.id);
  // A duplicate late commit for the same slot is refused.
  assert.equal(p.ledger.commit(slotA), false);
  await p.finish("b");
  p.flush();
  assert.deepEqual(
    p.items.map((m) => m.url),
    ["https://cdn/b"],
  );
  assert.equal(p.ledger.remaining, CAP - 1);
});

test("the publish check refuses pending, over-cap and out-of-sync snapshots on its own", async () => {
  const p = page();
  p.attach(["a"]);
  assert.equal(p.publish(), "pending");
  await p.finish("a");
  // Committed in the ledger, but the render hasn't happened yet.
  assert.equal(p.publish(), "out_of_sync");
  p.flush();
  assert.equal(p.publish(), "published");

  // A draft saved over the cap (by the old race) is kept, but not published.
  const big = page(Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, url: `u${i}` })));
  assert.equal(big.ledger.remaining, 0);
  assert.equal(big.publish(), "over_cap");
  big.remove("d0");
  big.remove("d1");
  big.flush();
  assert.equal(big.publish(), "published");

  const ledger = createPostMediaLedger(CAP, ["x"]);
  assert.equal(ledger.publishBlock(["x", "x"]), "out_of_sync");
  assert.equal(ledger.publishBlock(["y"]), "out_of_sync");
  assert.equal(ledger.publishBlock(["x"]), null);
});

test("normal single batch: publish once everything is in", async () => {
  const p = page();
  p.attach(["a", "b", "c"]);
  p.flush();
  assert.equal(p.canPost, false);
  await p.finish("a");
  await p.finish("b");
  await p.finish("c");
  p.flush();
  assert.equal(p.canPost, true);
  assert.equal(p.publish(), "published");
  assert.equal(p.published[0].length, 3);
});

test("reserve ignores nonsense counts", () => {
  const ledger = createPostMediaLedger(CAP);
  assert.equal(ledger.reserve(0).length, 0);
  assert.equal(ledger.reserve(-3).length, 0);
  assert.equal(ledger.reserve(Number.NaN).length, 0);
  assert.equal(ledger.reserve(2.7).length, 2);
});

test("insertBySeq keeps pick order and never duplicates", () => {
  const seq: Record<string, number> = { a: 0, b: 1, c: 2 };
  const seqOf = (id: string) => seq[id];
  let items = insertBySeq([], { id: "c" }, seqOf);
  items = insertBySeq(items, { id: "a" }, seqOf);
  items = insertBySeq(items, { id: "b" }, seqOf);
  items = insertBySeq(items, { id: "b" }, seqOf);
  assert.deepEqual(
    items.map((m) => m.id),
    ["a", "b", "c"],
  );
});
