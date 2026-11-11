// One-pixel rows let unequal-height posts pack tightly without changing
// their DOM, keyboard or chronological order. Bottom spacing is inside
// each grid item, so there is no row-gap multiplied by a tall row span.
export const POST_FEED_GAP_PX = 16;
export function postFeedRowSpan(height: number): number {
  return Number.isFinite(height) && height >= 0 ? Math.max(1, Math.ceil(height + POST_FEED_GAP_PX)) : 1;
}
