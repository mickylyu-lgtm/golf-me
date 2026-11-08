// Rounds the golfer hosts go to the top of the Rounds list (Micky,
// 2026-11-08), soonest tee time first; everything else keeps the order it
// already had (newest-posted, or best match). Stable, never mutates.
export function hostedFirst<T>(items: readonly T[], userId: string, pick: (item: T) => { hostId: string; dateISO: string }): T[] {
  const hosted: T[] = [];
  const rest: T[] = [];
  for (const item of items) (pick(item).hostId === userId ? hosted : rest).push(item);
  const at = (item: T) => {
    const ms = new Date(pick(item).dateISO).getTime();
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };
  hosted.sort((a, b) => at(a) - at(b));
  return [...hosted, ...rest];
}
