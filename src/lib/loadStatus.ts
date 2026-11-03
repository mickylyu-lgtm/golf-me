// Load bookkeeping shared by the real data contexts (RealRounds /
// RealCommunity / RealSocial). Before this, a failed first fetch only
// logged, and the context still reported "loaded" — so pages showed
// "nothing here yet" for what was really a network failure. Pure (no
// imports) so tests/loadStatus.test.ts can run it under node --test.
//
//   settled        a fetch has finished at least once (success or failure)
//   everSucceeded  at least one fetch succeeded, so the data in state is real
//   lastFailed     the most recent fetch failed
//
// A failed refetch never clears state in those contexts, so once a fetch has
// succeeded the old data stays on screen; only the notice changes.
export interface LoadStatus {
  settled: boolean;
  everSucceeded: boolean;
  lastFailed: boolean;
}

export const INITIAL_LOAD_STATUS: LoadStatus = { settled: false, everSucceeded: false, lastFailed: false };

export function applyLoadOutcome(prev: LoadStatus, ok: boolean): LoadStatus {
  const next: LoadStatus = { settled: true, everSucceeded: prev.everSucceeded || ok, lastFailed: !ok };
  return next.settled === prev.settled && next.everSucceeded === prev.everSucceeded && next.lastFailed === prev.lastFailed ? prev : next;
}

/** Nothing has ever loaded and the last attempt failed: show an error with retry, not "empty". */
export function isFirstLoadError(status: LoadStatus): boolean {
  return status.settled && !status.everSucceeded && status.lastFailed;
}

/** Data loaded earlier, but the latest refresh failed: keep the data, show a small notice. */
export function isRefreshError(status: LoadStatus): boolean {
  return status.everSucceeded && status.lastFailed;
}

export type ListView = "loading" | "error" | "empty" | "list";

/**
 * Which of the four states a list page should render. `count` is the total
 * number of items the page could show before its own search/tab filters,
 * so a filter that matches nothing still gets the page's normal empty copy.
 * Demo data is local and always loaded.
 */
export function listView(input: { count: number; isDemo: boolean; hasLoaded: boolean; loadError: boolean; isLoading: boolean }): ListView {
  if (input.count > 0) return "list";
  if (input.isDemo) return "empty";
  if (input.loadError) return input.isLoading ? "loading" : "error";
  if (!input.hasLoaded) return "loading";
  return "empty";
}
