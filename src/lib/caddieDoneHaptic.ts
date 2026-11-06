// Which analyses just finished: ids that were processing last time and are
// now 'complete'. A failed analysis never counts (same rule as the nav
// icon's completion pulse), and nothing counts on the first look, since
// there is no "before" to compare with (a cold launch with an already
// finished analysis is what the push notification is for).
export function newlyCompletedIds(
  previousProcessing: ReadonlySet<string> | null,
  analyses: readonly { id: string; status: string }[],
): string[] {
  if (!previousProcessing) return [];
  return analyses.filter((a) => a.status === "complete" && previousProcessing.has(a.id)).map((a) => a.id);
}

export function processingIds(analyses: readonly { id: string; status: string }[]): Set<string> {
  return new Set(analyses.filter((a) => a.status === "processing").map((a) => a.id));
}
