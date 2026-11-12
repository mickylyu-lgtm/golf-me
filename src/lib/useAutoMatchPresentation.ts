import { useContext, useEffect, useState } from "react";
import { AutoMatchStartedAt } from "./autoMatchStart";
import { isAutoMatchPresenting, updateAutoMatchPresentation } from "./autoMatchPresentation";

// One window for this visit/search and each new actual wait (including Retry).
// Changing result cards/preferences does not restart it. Data keeps loading in
// parallel, and a slow request stays visible after the minimum has elapsed.
export function useAutoMatchPresentation(searchKey: string, pending: boolean, interrupted: boolean): boolean {
  const startedAt = useContext(AutoMatchStartedAt);
  const [state, setState] = useState(() => updateAutoMatchPresentation(undefined, searchKey, pending, interrupted, startedAt ?? performance.now()));
  const next = updateAutoMatchPresentation(state, searchKey, pending, interrupted, performance.now());
  // Adjust before children render, so a new search never flashes old results.
  if (next !== state) setState(next);

  useEffect(() => {
    if (state.until === null || state.elapsed) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setState(current => current === state ? { ...current, elapsed: true } : current);
    }, Math.max(0, Math.ceil(state.until - performance.now())));
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [state]);

  return isAutoMatchPresenting(next);
}
