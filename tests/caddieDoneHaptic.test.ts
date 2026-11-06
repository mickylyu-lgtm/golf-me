// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { newlyCompletedIds, processingIds } from "../src/lib/caddieDoneHaptic.ts";

const row = (id: string, status: string) => ({ id, status });

test("processing -> complete counts once", () => {
  const before = processingIds([row("a", "processing"), row("b", "complete")]);
  assert.deepEqual(newlyCompletedIds(before, [row("a", "complete"), row("b", "complete")]), ["a"]);
  const after = processingIds([row("a", "complete"), row("b", "complete")]);
  assert.deepEqual(newlyCompletedIds(after, [row("a", "complete"), row("b", "complete")]), []);
});

test("nothing on the first look (cold launch with a finished analysis)", () => {
  assert.deepEqual(newlyCompletedIds(null, [row("a", "complete")]), []);
});

test("a failed analysis never counts", () => {
  const before = processingIds([row("a", "processing")]);
  assert.deepEqual(newlyCompletedIds(before, [row("a", "failed")]), []);
});

test("an analysis that was already complete, or new and complete, doesn't count", () => {
  const before = processingIds([row("a", "processing")]);
  assert.deepEqual(newlyCompletedIds(before, [row("a", "processing"), row("c", "complete")]), []);
});

test("a deleted analysis doesn't count", () => {
  const before = processingIds([row("a", "processing")]);
  assert.deepEqual(newlyCompletedIds(before, []), []);
});
