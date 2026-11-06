// Run: node --test tests/trimWindow.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialTrimWindow } from "../src/lib/trimWindow.ts";

test("a fresh pick starts at 0 with the longest allowed window", () => {
  assert.deepEqual(initialTrimWindow(25, 10, 2), { start: 0, end: 10 });
  assert.deepEqual(initialTrimWindow(25, 10, 2, {}), { start: 0, end: 10 });
});

test("Change section reopens on the previous window", () => {
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: 7, end: 15 }), { start: 7, end: 15 });
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: 15, end: 25 }), { start: 15, end: 25 });
});

test("a window past the end slides back inside the clip, keeping its length", () => {
  assert.deepEqual(initialTrimWindow(20, 10, 2, { start: 15, end: 25 }), { start: 10, end: 20 });
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: -3, end: 4 }), { start: 0, end: 7 });
});

test("length is capped at maxSeconds and floored at minSeconds", () => {
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: 2, end: 20 }), { start: 2, end: 12 });
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: 5, end: 5.5 }), { start: 5, end: 7 });
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: 9, end: 3 }), { start: 9, end: 11 });
});

test("bad durations or windows never produce NaN", () => {
  assert.deepEqual(initialTrimWindow(25, 10, 2, { start: Number.NaN, end: 8 }), { start: 0, end: 10 });
  assert.deepEqual(initialTrimWindow(Number.NaN, 10, 2, { start: 3, end: 8 }), { start: 0, end: 0 });
  assert.deepEqual(initialTrimWindow(Infinity, 10, 2), { start: 0, end: 0 });
});
