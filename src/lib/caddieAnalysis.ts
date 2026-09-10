import { useEffect, useState } from "react";
import type { CaddieAnalysis } from "../types";

// Matches analyze-swing/index.ts's own STALE_PROCESSING_MINUTES (there,
// used so an abandoned 'processing' row stops blocking a genuine retry as
// a "duplicate in-flight request"). The Edge Function's own pipeline runs
// via EdgeRuntime.waitUntil() after it already responds -- if the
// platform's background-execution time limit kills that run before it
// ever reaches its own try/catch fail() path, the row is left at
// 'processing' forever: nothing else will ever update or delete it.
// Reported live as "stuck at 80%, can't complete" -- an indefinite
// spinner with no way out. Reusing the same 5-minute threshold client-side
// turns that into a normal-looking "failed, try again" state instead,
// which retry() already handles correctly (the server's own duplicate
// check no longer matches a row this old, so it starts a fresh pipeline).
const STALE_PROCESSING_MINUTES = 5;

export function isStaleProcessing(analysis: Pick<CaddieAnalysis, "status" | "createdAt">): boolean {
  if (analysis.status !== "processing") return false;
  return Date.now() - new Date(analysis.createdAt).getTime() > STALE_PROCESSING_MINUTES * 60 * 1000;
}

// isStaleProcessing is a function of wall-clock time, not just of the
// analysis data itself -- a row watched live from the moment it started
// reads as not-stale and would stay that way forever with no further
// re-render to ever notice the 5-minute mark passing, since nothing about
// the underlying data changes while it's stuck. This forces a periodic
// re-render while `active`, so that check actually gets re-evaluated as
// time passes instead of only when a realtime update happens to arrive.
export function usePeriodicRerender(active: boolean, intervalMs = 15000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
