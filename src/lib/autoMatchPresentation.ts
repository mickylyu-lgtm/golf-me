// A presentation window, not a data request or progress estimate.
export const AUTO_MATCH_MINIMUM_MS = 2_000;

export interface AutoMatchPresentation {
  searchKey: string;
  pending: boolean;
  interrupted: boolean;
  until: number | null;
  elapsed: boolean;
}

// Pure transitions let quick retries/new searches invalidate an older timer.
// Errors and missing-location prompts interrupt immediately, never after a hold.
export function updateAutoMatchPresentation(
  previous: AutoMatchPresentation | undefined,
  searchKey: string,
  pending: boolean,
  interrupted: boolean,
  now: number,
): AutoMatchPresentation {
  if (previous && previous.searchKey === searchKey && previous.pending === pending && previous.interrupted === interrupted) return previous;
  const restart = !previous || previous.searchKey !== searchKey || previous.interrupted || (!previous.pending && pending);
  return {
    searchKey,
    pending,
    interrupted,
    until: interrupted ? null : restart ? now + AUTO_MATCH_MINIMUM_MS : previous.until,
    elapsed: interrupted || (!restart && previous.elapsed),
  };
}

export function isAutoMatchPresenting(state: AutoMatchPresentation): boolean {
  return !state.interrupted && (state.pending || !state.elapsed);
}
