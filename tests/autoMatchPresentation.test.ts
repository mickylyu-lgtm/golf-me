import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_MATCH_MINIMUM_MS, isAutoMatchPresenting, updateAutoMatchPresentation } from "../src/lib/autoMatchPresentation.ts";

const start = (pending = false, interrupted = false) => updateAutoMatchPresentation(undefined, "first", pending, interrupted, 100);

test("cached/demo entry holds for exactly a two-second window", () => {
  const state = start();
  assert.equal(AUTO_MATCH_MINIMUM_MS, 2000);
  assert.equal(state.until, 2100);
  assert.equal(isAutoMatchPresenting(state), true);
  assert.equal(isAutoMatchPresenting({ ...state, elapsed: true }), false);
});

test("fast load completion retains the original deadline", () => {
  const initial = start(true);
  const ready = updateAutoMatchPresentation(initial, "first", false, false, 400);
  assert.equal(ready.until, 2100);
  assert.equal(isAutoMatchPresenting(ready), true);
});

test("a long real wait outlives the minimum and settles immediately when ready", () => {
  const waiting = { ...start(true), elapsed: true };
  assert.equal(isAutoMatchPresenting(waiting), true);
  const ready = updateAutoMatchPresentation(waiting, "first", false, false, 5000);
  assert.equal(isAutoMatchPresenting(ready), false);
  assert.equal(ready.until, 2100);
});

test("ordinary rerenders preserve the exact timer identity", () => {
  const initial = start();
  assert.equal(updateAutoMatchPresentation(initial, "first", false, false, 1200), initial);
  const ready = { ...initial, elapsed: true };
  assert.equal(updateAutoMatchPresentation(ready, "first", false, false, 9000), ready);
});

test("errors or missing-location prompts cancel the minimum immediately", () => {
  for (const pending of [false, true]) {
    const interrupted = updateAutoMatchPresentation(start(pending), "first", pending, true, 300);
    assert.equal(isAutoMatchPresenting(interrupted), false);
    assert.equal(interrupted.until, null);
    assert.equal(interrupted.elapsed, true);
  }
  assert.equal(isAutoMatchPresenting(start(false, true)), false);
});

test("retry or resolving a required prompt starts a fresh window", () => {
  const blocked = start(false, true);
  const retry = updateAutoMatchPresentation(blocked, "first", true, false, 500);
  assert.equal(retry.until, 2500);
  assert.equal(isAutoMatchPresenting(retry), true);
  const ready = updateAutoMatchPresentation(retry, "first", false, false, 600);
  assert.equal(ready.until, 2500);
  assert.equal(isAutoMatchPresenting(ready), true);
});

test("a new actual wait after results starts its own minimum", () => {
  const ready = { ...start(), elapsed: true };
  const next = updateAutoMatchPresentation(ready, "first", true, false, 8000);
  assert.equal(next.until, 10000);
  assert.equal(next.elapsed, false);
});

test("a new search/account identity cannot reuse a previous deadline", () => {
  const initial = start();
  const next = updateAutoMatchPresentation(initial, "second", false, false, 1900);
  assert.notEqual(next, initial);
  assert.equal(next.until, 3900);
  assert.equal(next.elapsed, false);
});

test("a completed lazy-route radar contributes to the same window", () => {
  // The entry boundary supplies the earlier route timestamp, not mount time.
  const page = updateAutoMatchPresentation(undefined, "first", false, false, 100);
  const remainingAtPageMount = Math.max(0, page.until! - 2600);
  assert.equal(remainingAtPageMount, 0);
});
