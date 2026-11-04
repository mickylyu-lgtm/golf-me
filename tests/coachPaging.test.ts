// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginateBlocks } from "../src/lib/coachPaging.ts";

const GAP = 6;
// Checkpoint card: [good] then [fix, cue] as one group.
const checkpoint = (good: number, fix: number, cue: number) => [
  { group: 0, height: good },
  { group: 1, height: fix },
  { group: 1, height: cue },
];

test("everything that fits stays on one page", () => {
  assert.deepEqual(paginateBlocks(checkpoint(32, 32, 40), 200, GAP), [[0, 1, 2]]);
});

test("only splits when it doesn't fit: doing well, then fix + cue", () => {
  assert.deepEqual(paginateBlocks(checkpoint(90, 60, 50), 160, GAP), [[0], [1, 2]]);
});

test("a group taller than the budget is split into its blocks", () => {
  assert.deepEqual(paginateBlocks(checkpoint(20, 100, 80), 150, GAP), [[0, 1], [2]]);
  assert.deepEqual(paginateBlocks(checkpoint(140, 120, 80), 150, GAP), [[0], [1], [2]]);
});

test("a single block taller than the budget gets its own page, never cut or dropped", () => {
  assert.deepEqual(paginateBlocks([{ group: 0, height: 400 }, { group: 1, height: 20 }], 150, GAP), [[0], [1]]);
});

test("the gap between blocks counts toward the budget", () => {
  // 50 + 6 + 50 = 106 > 105
  assert.deepEqual(paginateBlocks([{ group: 0, height: 50 }, { group: 1, height: 50 }], 105, GAP), [[0], [1]]);
  assert.deepEqual(paginateBlocks([{ group: 0, height: 50 }, { group: 1, height: 50 }], 106, GAP), [[0, 1]]);
});

test("summary: focus, work-on items, drill name + steps; groups merge while they fit", () => {
  const blocks = [
    { group: 0, height: 60 }, // focus
    { group: 1, height: 70 }, // work 0
    { group: 1, height: 50 }, // work 1
    { group: 2, height: 32 }, // drill name
    { group: 2, height: 60 }, // drill steps
  ];
  assert.deepEqual(paginateBlocks(blocks, 140, GAP), [[0], [1, 2], [3, 4]]);
  assert.deepEqual(paginateBlocks(blocks, 1000, GAP), [[0, 1, 2, 3, 4]]);
});

test("every block appears exactly once, in order", () => {
  const blocks = Array.from({ length: 9 }, (_, i) => ({ group: Math.floor(i / 2), height: 20 + ((i * 37) % 90) }));
  for (const budget of [60, 100, 150, 400]) {
    assert.deepEqual(paginateBlocks(blocks, budget, GAP).flat(), blocks.map((_, i) => i));
  }
  assert.deepEqual(paginateBlocks([], 100, GAP), []);
});
