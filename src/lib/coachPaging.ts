// Coach Replay card paging (Micky, 2026-11-03: show the full feedback, never
// "…", never a scrolling card, never over the clip). A card's content is a
// list of blocks (e.g. "Doing well", "One thing to fix", the cue), each in a
// group that should stay together when it can ("One thing to fix" + its
// cue). Heights are MEASURED from the rendered blocks, never estimated from
// character counts, so this works for every language and font size.
//
// Greedy, in order:
//   - a group that fits the budget joins the current page if there's room,
//     else starts a new page;
//   - a group taller than the budget is split into its blocks, each placed
//     the same way;
//   - a single block taller than the budget still gets a page of its own
//     (shown in full: the text is never cut).
// So when everything fits, it's one page; it only splits when it doesn't.

export interface PagingBlock {
  group: number;
  height: number;
}

// Returns pages as lists of block indices, in order. `gap` is the space
// between two blocks on the same page.
export function paginateBlocks(blocks: readonly PagingBlock[], budget: number, gap: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let currentHeight = 0;
  const place = (indices: number[], height: number) => {
    if (current.length > 0 && currentHeight + gap + height <= budget) {
      current.push(...indices);
      currentHeight += gap + height;
    } else {
      if (current.length > 0) pages.push(current);
      current = [...indices];
      currentHeight = height;
    }
  };
  let i = 0;
  while (i < blocks.length) {
    const group = blocks[i].group;
    const members: number[] = [];
    while (i < blocks.length && blocks[i].group === group) members.push(i++);
    const groupHeight = members.reduce((sum, m) => sum + Math.max(0, blocks[m].height), 0) + gap * (members.length - 1);
    if (groupHeight <= budget) place(members, groupHeight);
    else for (const m of members) place([m], Math.max(0, blocks[m].height));
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

// ── One block taller than a whole page ──────────────────────────────────
// A long analysis sentence (often Japanese/Korean/Chinese, where a line
// holds fewer characters) can make one finding taller than the budget on
// its own. Rather than overflow the card or cut the text, such a block is
// split at sentence boundaries: each sentence is measured on its own (with
// the block's label), and the sentences are paged like blocks. Consecutive
// sentences that land on one page are shown together as one finding again.

// The text split into sentences, each keeping its own trailing space, so
// joining them gives back the original text exactly.
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "sentence" }).segment(text), (s) => s.segment)
    : (text.match(/[^.!?。！？]+(?:[.!?。！？]+["'”’」』)]*\s*|$)/g) ?? [text]).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

// A run of sentences [from, to) of one block's text.
export interface BlockPart {
  block: number;
  from: number;
  to: number;
}
export type PageItem = number | BlockPart;

export interface SplittableBlock extends PagingBlock {
  // Measured height of each sentence on its own (label included), when the
  // block's text has more than one sentence.
  sentenceHeights?: readonly number[];
}

// paginateBlocks, except that a block taller than the budget with several
// sentences is paged sentence by sentence. Pages list block indices, or a
// BlockPart for a block shown only in part on that page.
export function paginateWithSentences(blocks: readonly SplittableBlock[], budget: number, gap: number): PageItem[][] {
  const units: { group: number; height: number; block: number; sentence?: number }[] = [];
  blocks.forEach((b, block) => {
    const s = b.sentenceHeights;
    if (b.height > budget && s && s.length > 1) s.forEach((height, sentence) => units.push({ group: b.group, height, block, sentence }));
    else units.push({ group: b.group, height: b.height, block });
  });
  return paginateBlocks(units, budget, gap).map((page) => {
    const items: PageItem[] = [];
    for (const u of page.map((i) => units[i])) {
      if (u.sentence === undefined) {
        items.push(u.block);
        continue;
      }
      const last = items[items.length - 1];
      if (typeof last === "object" && last.block === u.block && last.to === u.sentence) last.to += 1;
      else items.push({ block: u.block, from: u.sentence, to: u.sentence + 1 });
    }
    // A block whose every sentence landed on this page is just the block.
    return items.map((it) => (typeof it === "object" && it.from === 0 && it.to === (blocks[it.block].sentenceHeights?.length ?? 0) ? it.block : it));
  });
}

// Fraction of the screen height a coach card (chrome + content) may take.
// 40% on a 375x667 phone is 267 px: room for a full card in English, and
// the clip keeps ~60% of the screen in fullscreen.
export const COACH_CARD_MAX_SCREEN_FRACTION = 0.4;
