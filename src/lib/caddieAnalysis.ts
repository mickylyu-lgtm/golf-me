import { useEffect, useState } from "react";
import type { CaddieAnalysis } from "../types";

// Related to analyze-swing/index.ts's own STALE_PROCESSING_MINUTES (there,
// used so an abandoned 'processing' row stops blocking a genuine retry as
// a "duplicate in-flight request"). The Edge Function's own pipeline runs
// via EdgeRuntime.waitUntil() after it already responds -- if the
// platform's background-execution time limit kills that run before it
// ever reaches its own try/catch fail() path, the row is left at
// 'processing' forever: nothing else will ever update or delete it.
// Reported live as "stuck at 80%, can't complete" -- an indefinite
// spinner with no way out. A client-side stale threshold turns that into a
// normal-looking "failed, try again" state instead, which retry() already
// handles correctly (the server's own duplicate check no longer matches a
// row this old, so it starts a fresh pipeline).
//
// Deliberately longer than the server's 5 minutes: a legitimately long run
// (a 52 MB .mov with a Roboflow retry took ~3.5 min) must not read as
// "failed" while it's still genuinely working. Diverging in this direction
// is safe -- by the time the client offers Try again (10 min) the server
// already treats the row as abandoned (5 min), so retry() still starts a
// fresh pipeline rather than being refused as a duplicate in-flight run.
// Never set this BELOW the server's value, or Try again would be refused.
const STALE_PROCESSING_MINUTES = 10;

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

// analyze-swing rejection with its HTTP status, so a caller can tell a
// definite "no row was created" answer (400/401/403/429 -- every one of
// those returns before or at the insert) from an ambiguous network/gateway
// failure where the row may exist. AnalyzeSwing only cleans up its uploaded
// private files for the definite case.
export class CaddieRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CaddieRequestError";
    this.status = status;
  }
}
