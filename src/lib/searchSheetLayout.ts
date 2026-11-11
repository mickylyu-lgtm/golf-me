// Pure geometry for the opt-in search sheet. Search/result changes are not
// inputs: neither loading nor an empty match can move the header.
export function searchSheetLayout({ height, width, visibleBottom, chromeHeight }: {
  height: number; width: number; visibleBottom: number; chromeHeight: number;
}): { top: number; bottom: number } {
  const h = Math.max(0, Number.isFinite(height) ? height : 0);
  const closedHeight = Math.min(h * 0.88, 720);
  const restingTop = width >= 640 ? (h - closedHeight) / 2 : h - closedHeight;
  const restingBottom = width >= 640 ? h - restingTop : h;
  const bottom = Math.max(0, Math.min(restingBottom, Number.isFinite(visibleBottom) ? visibleBottom : h));
  // Keep the same top unless landscape/large text truly needs more room.
  // Reserve at least one touch-sized result below the measured header.
  const top = Math.min(restingTop, Math.max(12, bottom - Math.max(0, chromeHeight) - 64));
  return { top: Math.min(top, bottom), bottom };
}
