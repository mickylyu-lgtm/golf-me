// Run: node --test tests/replayControls.test.ts  (built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlsVisible, formatReplayTime } from "../src/lib/replayControls.ts";
import { filmstripTimes } from "../src/lib/trimWindow.ts";

const base = { revealed: false, held: false, paused: false, frozenAtCheckpoint: false };

test("a coach checkpoint pause shows no playback chrome by itself", () => {
  assert.equal(controlsVisible({ ...base, paused: true, frozenAtCheckpoint: true }), false);
});

test("a tap reveals the controls at a checkpoint too", () => {
  assert.equal(controlsVisible({ ...base, paused: true, frozenAtCheckpoint: true, revealed: true }), true);
});

test("playing hides the controls unless revealed or held", () => {
  assert.equal(controlsVisible(base), false);
  assert.equal(controlsVisible({ ...base, revealed: true }), true);
  assert.equal(controlsVisible({ ...base, held: true }), true);
});

test("any other pause keeps a visible way to play (first load, background, own pause)", () => {
  assert.equal(controlsVisible({ ...base, paused: true }), true);
});

test("scrubbing or focus holds them even at a checkpoint", () => {
  assert.equal(controlsVisible({ ...base, paused: true, frozenAtCheckpoint: true, held: true }), true);
});

test("replay clock shows tenths", () => {
  assert.equal(formatReplayTime(0), "0:00.0");
  assert.equal(formatReplayTime(3.46), "0:03.4");
  assert.equal(formatReplayTime(61.05), "1:01.0");
  assert.equal(formatReplayTime(Number.NaN), "0:00.0");
  assert.equal(formatReplayTime(-2), "0:00.0");
});

test("filmstrip samples slot middles inside the clip", () => {
  assert.deepEqual(filmstripTimes(10, 5), [1, 3, 5, 7, 9]);
  const t = filmstripTimes(0.2, 4);
  assert.equal(t.length, 4);
  for (const x of t) assert.ok(x >= 0.05 - 1e-9 && x <= 0.15 + 1e-9);
  assert.deepEqual(filmstripTimes(0, 10), []);
  assert.deepEqual(filmstripTimes(Number.NaN, 10), []);
  const long = filmstripTimes(3600, 10);
  assert.equal(long[0], 180);
  assert.equal(long[9], 3420);
});
