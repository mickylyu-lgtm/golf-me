// The list may shrink between taps; advance from the card actually shown.
export function visibleAutoMatchResultIndex(index: number, count: number): number {
  return Math.min(index, Math.max(count - 1, 0));
}

export function nextAutoMatchResultIndex(index: number, count: number): number {
  return count > 1 ? (visibleAutoMatchResultIndex(index, count) + 1) % count : 0;
}
