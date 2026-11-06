// Run: node --test tests/trimReopen.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { canStartAnalysis, createTrimReopenGate, resolveTrimReopen, type TrimDraftIdentity } from "../src/lib/trimReopen.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const fileA = { name: "a.mov" };
  const draftA: TrimDraftIdentity = { file: fileA, previewUrl: "blob:a" };
  let current: TrimDraftIdentity | undefined = draftA;
  const gate = createTrimReopenGate();
  return {
    gate,
    draftA,
    setDraft(next: TrimDraftIdentity | undefined) {
      current = next;
    },
    getDraft: () => current,
  };
}

test("preview length available: opens at once with that length", async () => {
  const s = setup();
  let reads = 0;
  const outcome = await resolveTrimReopen({
    gate: s.gate,
    draft: s.draftA,
    getDraft: s.getDraft,
    previewDuration: 25,
    readDuration: async () => {
      reads += 1;
      return 99;
    },
  });
  assert.deepEqual(outcome, { kind: "open", duration: 25 });
  assert.equal(reads, 0);
  assert.equal(s.gate.pending, false);
});

test("slow metadata, nothing changes: opens with the read length once it arrives", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: Number.NaN, readDuration: () => d.promise });
  assert.equal(s.gate.pending, true, "busy while the length is being read");
  d.resolve(30);
  assert.deepEqual(await run, { kind: "open", duration: 30 });
  assert.equal(s.gate.pending, false);
});

test("draft removed before the length arrives: stale, selector stays closed", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  s.gate.cancel();
  s.setDraft(undefined);
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("draft removed without cancelling the gate is still caught by the identity check", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  s.setDraft(undefined);
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("replaced with a different video before the length arrives: stale", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: 0, readDuration: () => d.promise });
  s.setDraft({ file: { name: "b.mov" }, previewUrl: "blob:b" });
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("same File but a new preview URL counts as a different draft", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  s.setDraft({ file: s.draftA.file, previewUrl: "blob:a2" });
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("analysis started (draft cleared on success) before the length arrives: stale", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  // The page refuses to analyze while reopening...
  assert.equal(canStartAnalysis({ hasVideo: true, submitting: false, selectorOpen: false, reopening: s.gate.pending }), false);
  // ...and even if it had, the draft it started from is gone by the time the length lands.
  s.setDraft(undefined);
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("cancelled (page left) with the same draft still present: stale", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  s.gate.cancel();
  assert.equal(s.gate.pending, false);
  d.resolve(30);
  assert.deepEqual(await run, { kind: "stale" });
});

test("an older token is ignored once a newer reopen started", async () => {
  const s = setup();
  const first = deferred<number>();
  const second = deferred<number>();
  const run1 = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => first.promise });
  const run2 = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => second.promise });
  first.resolve(11);
  assert.deepEqual(await run1, { kind: "stale" });
  assert.equal(s.gate.pending, true, "the old token's end() doesn't clear the newer one");
  second.resolve(22);
  assert.deepEqual(await run2, { kind: "open", duration: 22 });
  assert.equal(s.gate.pending, false);
});

test("raw gate: stale token and wrong draft are never current", () => {
  const gate = createTrimReopenGate();
  const draft = { file: {}, previewUrl: "blob:x" };
  const t1 = gate.begin(draft);
  const t2 = gate.begin(draft);
  assert.equal(gate.isCurrent(t1, draft), false);
  assert.equal(gate.isCurrent(t2, draft), true);
  assert.equal(gate.isCurrent(t2, undefined), false);
  assert.equal(gate.isCurrent(t2, { file: {}, previewUrl: "blob:x" }), false, "identity, not equality");
  gate.end(t1);
  assert.equal(gate.pending, true);
  gate.end(t2);
  assert.equal(gate.pending, false);
  assert.equal(gate.isCurrent(t2, draft), false);
});

test("same draft but no usable length: noDuration (toast), not stale", async () => {
  const s = setup();
  assert.deepEqual(
    await resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: async () => Number.POSITIVE_INFINITY }),
    { kind: "noDuration" },
  );
  assert.deepEqual(
    await resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => Promise.reject(new Error("no metadata")) }),
    { kind: "noDuration" },
  );
  assert.equal(s.gate.pending, false);
});

test("a failed read after the draft changed stays silent (stale, no toast)", async () => {
  const s = setup();
  const d = deferred<number>();
  const run = resolveTrimReopen({ gate: s.gate, draft: s.draftA, getDraft: s.getDraft, previewDuration: undefined, readDuration: () => d.promise });
  s.setDraft(undefined);
  d.reject(new Error("gone"));
  assert.deepEqual(await run, { kind: "stale" });
});

test("canStartAnalysis: needs a video, no submit, no open or reopening selector", () => {
  const ok = { hasVideo: true, submitting: false, selectorOpen: false, reopening: false };
  assert.equal(canStartAnalysis(ok), true);
  assert.equal(canStartAnalysis({ ...ok, hasVideo: false }), false);
  assert.equal(canStartAnalysis({ ...ok, submitting: true }), false);
  assert.equal(canStartAnalysis({ ...ok, selectorOpen: true }), false);
  assert.equal(canStartAnalysis({ ...ok, reopening: true }), false);
});
