// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginateBlocks, paginateWithSentences, splitSentences } from "../src/lib/coachPaging.ts";

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

// ── A single finding taller than the page ───────────────────────────────

test("splitSentences: keeps every character, in English and CJK", () => {
  const en = "Your hips slid toward the target. Turn them instead! Then hold the finish.";
  assert.deepEqual(splitSentences(en), ["Your hips slid toward the target. ", "Turn them instead! ", "Then hold the finish."]);
  const ja = "腰がターゲット方向に流れています。回転を意識しましょう。フィニッシュで止まりましょう。";
  assert.equal(splitSentences(ja).length, 3);
  assert.equal(splitSentences(ja).join(""), ja);
  assert.deepEqual(splitSentences("One sentence, no stop"), ["One sentence, no stop"]);
  assert.deepEqual(splitSentences(""), []);
});

test("blocks that fit are paged exactly as before", () => {
  const blocks = [
    { group: 0, height: 90, sentenceHeights: [50, 50] },
    { group: 1, height: 60 },
    { group: 1, height: 50 },
  ];
  assert.deepEqual(paginateWithSentences(blocks, 160, GAP), paginateBlocks(blocks, 160, GAP));
});

test("an oversized finding is paged by sentence; sentences on one page stay one finding", () => {
  // fix: 3 sentences, 300 px in full, 70 px each alone; budget 150.
  const blocks = [
    { group: 0, height: 40 },
    { group: 1, height: 300, sentenceHeights: [70, 70, 70] },
    { group: 1, height: 30 },
  ];
  assert.deepEqual(paginateWithSentences(blocks, 150, GAP), [
    [0, { block: 1, from: 0, to: 1 }],
    [{ block: 1, from: 1, to: 3 }],
    [2],
  ]);
});

test("one sentence alone still taller than the page gets a page of its own, never cut", () => {
  const blocks = [{ group: 0, height: 500, sentenceHeights: [400, 60] }];
  assert.deepEqual(paginateWithSentences(blocks, 150, GAP), [[{ block: 0, from: 0, to: 1 }], [{ block: 0, from: 1, to: 2 }]]);
  // A single long sentence can't be split: the block keeps its own page.
  assert.deepEqual(paginateWithSentences([{ group: 0, height: 500, sentenceHeights: [500] }], 150, GAP), [[0]]);
});

test("every sentence of every block is shown exactly once, in order", () => {
  const blocks = [
    { group: 0, height: 260, sentenceHeights: [60, 90, 40, 80] },
    { group: 1, height: 40 },
    { group: 1, height: 220, sentenceHeights: [120, 110] },
  ];
  for (const budget of [100, 150, 200, 1000]) {
    const seen: string[] = [];
    for (const page of paginateWithSentences(blocks, budget, GAP))
      for (const it of page) {
        if (typeof it === "number") (blocks[it].sentenceHeights ?? [0]).forEach((_, s) => seen.push(`${it}:${s}`));
        else for (let s = it.from; s < it.to; s++) seen.push(`${it.block}:${s}`);
      }
    assert.deepEqual(seen, ["0:0", "0:1", "0:2", "0:3", "1:0", "2:0", "2:1"], `budget ${budget}`);
  }
});
