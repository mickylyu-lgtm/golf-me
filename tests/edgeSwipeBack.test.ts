// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMove, dragOffset, isEdgeStart, shouldComplete } from "../src/lib/edgeSwipeBack.ts";

test("only a start near the left edge counts", () => {
  assert.equal(isEdgeStart(0), true);
  assert.equal(isEdgeStart(20), true);
  assert.equal(isEdgeStart(32), true);
  assert.equal(isEdgeStart(33), false);
  assert.equal(isEdgeStart(200), false);
  assert.equal(isEdgeStart(-1), false);
});

test("classifyMove waits for the slop, then wants rightward and mostly horizontal", () => {
  assert.equal(classifyMove(5, 3), "pending");
  assert.equal(classifyMove(-5, 9), "pending");
  assert.equal(classifyMove(20, 4), "back");
  assert.equal(classifyMove(20, -15), "back");
  assert.equal(classifyMove(-20, 2), "other"); // leftward: the reveal-times swipe
  assert.equal(classifyMove(4, 20), "other"); // vertical: scroll
  assert.equal(classifyMove(12, 12), "other"); // diagonal tie is not back
});

test("dragOffset never goes left of the resting position", () => {
  assert.equal(dragOffset(-30), 0);
  assert.equal(dragOffset(0), 0);
  assert.equal(dragOffset(42), 42);
});

test("shouldComplete: distance threshold, fling, and a leftward release", () => {
  const w = 390;
  assert.equal(shouldComplete(100, w, 0), false); // ~26%
  assert.equal(shouldComplete(137, w, 0), true); // ~35%
  assert.equal(shouldComplete(300, w, 0.1), true);
  assert.equal(shouldComplete(60, w, 0.8), true); // fling
  assert.equal(shouldComplete(10, w, 2), false); // fling too short
  assert.equal(shouldComplete(300, w, -0.5), false); // pulled back left
  assert.equal(shouldComplete(300, 0, 0), false);
});
