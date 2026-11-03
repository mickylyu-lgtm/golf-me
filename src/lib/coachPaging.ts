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

// Fraction of the screen height a coach card (chrome + content) may take.
// 40% on a 375x667 phone is 267 px: room for a full card in English, and
// the clip keeps ~60% of the screen in fullscreen.
export const COACH_CARD_MAX_SCREEN_FRACTION = 0.4;
