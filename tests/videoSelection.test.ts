// Run: node --test tests/videoSelection.test.ts  (built-in type stripping)
//
// Caddie > Upload a swing video: a pick being prepared (length read +
// in-memory copy) only lands if it is still the newest pick of an open page
// (src/lib/videoSelection.ts). The page below mirrors AnalyzeSwing's
// acceptVideoFile: begin, prepare, clear the spinner only when nothing newer
// is pending, then set the draft or open the trim selector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVideoSelectionGate, prepareVideoSelection, videoPickRejection } from "../src/lib/videoSelection.ts";

const MAX_SECONDS = 10;
const MAX_BYTES = 200 * 1024 * 1024;

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

interface Clip {
  name: string;
  stable?: boolean;
}

function page() {
  const gate = createVideoSelectionGate();
  // Every request per file name (the same clip can be picked twice).
  const durations = new Map<string, ReturnType<typeof deferred<number>>[]>();
  const copies = new Map<string, ReturnType<typeof deferred<Clip>>[]>();
  const add = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  const state = {
    draft: undefined as { file: Clip; previewUrl: string } | undefined,
    trim: undefined as { file: Clip; previewUrl: string; duration: number } | undefined,
    preparing: false,
    created: [] as string[],
    errors: [] as string[],
    toasts: [] as string[],
  };
  async function pick(name: string, meta: { type: string; size: number } = { type: "video/quicktime", size: 1000 }) {
    const token = gate.begin();
    const rejection = videoPickRejection(meta, MAX_BYTES);
    if (rejection) {
      gate.end(token);
      state.preparing = false;
      state.toasts.push(rejection === "too_large" ? "caddie.videoTooLarge" : "caddie.unsupportedVideo");
      return;
    }
    state.preparing = true;
    const outcome = await prepareVideoSelection<Clip>({
      gate,
      token,
      file: { name },
      readDuration: (f) => {
        const d = deferred<number>();
        add(durations, f.name, d);
        return d.promise;
      },
      stabilize: (f) => {
        const d = deferred<Clip>();
        add(copies, f.name, d);
        return d.promise;
      },
      onStabilizeError: () => state.errors.push(name),
    });
    if (!gate.pending) state.preparing = false;
    if (outcome.kind === "stale") return;
    if (outcome.kind === "rejected") {
      state.toasts.push(outcome.reason === "too_long" ? "caddie.videoTooLong" : "caddie.durationUnreadable");
      return;
    }
    const previewUrl = `blob:${outcome.file.name}`;
    state.created.push(previewUrl);
    if (outcome.duration !== undefined && outcome.duration > MAX_SECONDS) {
      state.trim = { file: outcome.file, previewUrl, duration: outcome.duration };
      return;
    }
    state.trim = undefined;
    state.draft = { file: outcome.file, previewUrl };
  }
  return {
    gate,
    state,
    pick,
    async duration(name: string, seconds: number) {
      await tick();
      for (const d of durations.get(name) ?? []) d.resolve(seconds);
      await tick();
    },
    async durationFails(name: string) {
      await tick();
      for (const d of durations.get(name) ?? []) d.reject(new Error("metadata"));
      await tick();
    },
    async copy(name: string) {
      await tick();
      for (const d of copies.get(name) ?? []) d.resolve({ name, stable: true });
      await tick();
    },
    async copyFails(name: string) {
      await tick();
      for (const d of copies.get(name) ?? []) d.reject(new Error("read"));
      await tick();
    },
    async ready(name: string, seconds = 8) {
      await this.duration(name, seconds);
      await this.copy(name);
    },
  };
}

test("A starts, B starts, B completes, then A completes: B stays", async () => {
  const p = page();
  const a = p.pick("a");
  const b = p.pick("b");
  await p.ready("b");
  await b;
  assert.equal(p.state.draft?.file.name, "b");
  assert.equal(p.state.preparing, false);
  await p.ready("a");
  await a;
  assert.equal(p.state.draft?.file.name, "b");
  assert.deepEqual(p.state.created, ["blob:b"], "no preview URL is made for a dropped pick");
});

test("A's late long-clip answer doesn't open the trim selector over B", async () => {
  const p = page();
  const a = p.pick("a");
  const b = p.pick("b");
  await p.ready("b", 8);
  await p.ready("a", 40);
  await Promise.all([a, b]);
  assert.equal(p.state.trim, undefined);
  assert.equal(p.state.draft?.file.name, "b");
});

test("A fails after B succeeded: no error and no change on B", async () => {
  const p = page();
  const a = p.pick("a");
  const b = p.pick("b");
  await p.ready("b");
  await p.durationFails("a");
  await p.copyFails("a");
  await Promise.all([a, b]);
  assert.equal(p.state.draft?.file.name, "b");
  assert.deepEqual(p.state.errors, []);
});

test("A completes or fails while B is still pending: B keeps its spinner, then lands", async () => {
  const p = page();
  const a = p.pick("a");
  const b = p.pick("b");
  await p.ready("a");
  await a;
  assert.equal(p.state.draft, undefined);
  assert.equal(p.state.preparing, true, "A finishing must not clear B's loading");
  await p.ready("b");
  await b;
  assert.equal(p.state.draft?.file.name, "b");
  assert.equal(p.state.preparing, false);

  const q = page();
  const qa = q.pick("a");
  const qb = q.pick("b");
  await q.durationFails("a");
  await qa;
  assert.equal(q.state.preparing, true);
  assert.deepEqual(q.state.errors, []);
  await q.ready("b");
  await qb;
  assert.equal(q.state.draft?.file.name, "b");
});

test("A -> B -> A while pending: only the newest A lands", async () => {
  const p = page();
  const a1 = p.pick("a");
  const b = p.pick("b");
  // Same file name as the first pick; a separate request all the same.
  const durationsBefore = p.state.created.length;
  const a2 = p.pick("a");
  await p.ready("b");
  await b;
  assert.equal(p.state.draft, undefined, "B was superseded by the second A");
  await p.ready("a");
  await Promise.all([a1, a2]);
  assert.equal(p.state.draft?.file.name, "a");
  assert.equal(p.state.created.length, durationsBefore + 1);
});

test("multiple requests for the same selection: the last one wins, once", async () => {
  const p = page();
  const first = p.pick("same");
  const second = p.pick("same");
  await p.ready("same");
  await Promise.all([first, second]);
  assert.deepEqual(p.state.created, ["blob:same"]);
});

test("leaving the page drops a pending pick, and a pick after leaving never lands", async () => {
  const p = page();
  const a = p.pick("a");
  p.gate.close();
  await p.ready("a");
  await a;
  assert.equal(p.state.draft, undefined);
  // A native pick resolving after unmount still calls acceptVideoFile.
  const late = p.pick("late");
  await p.ready("late");
  await late;
  assert.equal(p.state.draft, undefined);
  // Remount (StrictMode re-runs the effect; a real remount gets a new gate).
  p.gate.open();
  const c = p.pick("c");
  await p.ready("c");
  await c;
  assert.equal(p.state.draft?.file.name, "c");
});

test("Remove cancels the pick being prepared", async () => {
  const p = page();
  const a = p.pick("a");
  p.gate.cancel();
  assert.equal(p.gate.pending, false);
  await p.ready("a");
  await a;
  assert.equal(p.state.draft, undefined);
});

test("normal load, unreadable length and a failing copy for the current pick", async () => {
  const p = page();
  const a = p.pick("a");
  await p.ready("a", 9);
  await a;
  assert.deepEqual(p.state.draft, { file: { name: "a", stable: true }, previewUrl: "blob:a" });

  const q = page();
  const b = q.pick("b");
  await q.durationFails("b");
  await q.copy("b");
  await b;
  assert.equal(q.state.draft, undefined, "unreadable duration is never uploaded");
  assert.deepEqual(q.state.toasts, ["caddie.durationUnreadable"]);

  const r = page();
  const c = r.pick("c");
  await r.duration("c", 9);
  await r.copyFails("c");
  await c;
  assert.deepEqual(r.state.errors, ["c"], "the current pick's copy error is reported");
  assert.deepEqual(r.state.draft?.file, { name: "c" }, "falls back to the original file");
  assert.equal(r.state.preparing, false);
});

test("a stale pick skips its in-memory copy entirely", async () => {
  const gate = createVideoSelectionGate();
  let copies = 0;
  const d = deferred<number>();
  const token = gate.begin();
  const run = prepareVideoSelection({
    gate,
    token,
    file: "a",
    readDuration: () => d.promise,
    stabilize: async (f) => {
      copies += 1;
      return f;
    },
  });
  gate.begin();
  d.resolve(5);
  assert.deepEqual(await run, { kind: "stale" });
  assert.equal(copies, 0);
});

// Micky, 2026-11-06: the newest selection wins even when it's invalid; a
// clear error, and the older pick is never silently restored.
for (const [label, meta, toast] of [
  ["wrong type", { type: "image/jpeg", size: 1000 }, "caddie.unsupportedVideo"],
  ["unreadable native pick (empty, untyped)", { type: "application/octet-stream", size: 0 }, "caddie.unsupportedVideo"],
  ["empty video file", { type: "video/mp4", size: 0 }, "caddie.unsupportedVideo"],
  ["too large", { type: "video/mp4", size: MAX_BYTES + 1 }, "caddie.videoTooLarge"],
] as const) {
  test(`a newer invalid pick (${label}) wins: its error shows and A's late result does nothing`, async () => {
    const p = page();
    const a = p.pick("a");
    assert.equal(p.state.preparing, true);
    await p.pick("bad", meta);
    assert.deepEqual(p.state.toasts, [toast]);
    assert.equal(p.state.preparing, false, "A's spinner is gone with A");
    await p.ready("a");
    await a;
    assert.equal(p.state.draft, undefined, "A is not restored");
    assert.equal(p.state.trim, undefined);
    assert.deepEqual(p.state.created, [], "no preview URL for A");
    assert.equal(p.state.preparing, false);
    assert.deepEqual(p.state.toasts, [toast], "no second message");
  });
}

test("an invalid pick, then a valid one: the valid one lands", async () => {
  const p = page();
  await p.pick("bad", { type: "text/plain", size: 10 });
  const b = p.pick("b");
  await p.ready("b");
  await b;
  assert.equal(p.state.draft?.file.name, "b");
  assert.deepEqual(p.state.toasts, ["caddie.unsupportedVideo"]);
});

test("videoPickRejection boundaries", () => {
  assert.equal(videoPickRejection({ type: "video/quicktime", size: MAX_BYTES }, MAX_BYTES), null);
  assert.equal(videoPickRejection({ type: "video/quicktime", size: MAX_BYTES + 1 }, MAX_BYTES), "too_large");
  assert.equal(videoPickRejection({ type: "video/mp4", size: 1 }, MAX_BYTES), null);
  assert.equal(videoPickRejection({ type: "", size: 5 }, MAX_BYTES), "unsupported");
});
