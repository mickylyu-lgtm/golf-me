import { useMemo } from "react";
import { useData } from "../context/DataContext";
import type { AppNotification } from "../types";
import { isStaleProcessing, usePeriodicRerender } from "./caddieAnalysis";

export interface CaddieNavStatus {
  isProcessing: boolean;
  unseenNotification: AppNotification | undefined;
}

// Both derived entirely from state that already exists globally elsewhere —
// caddieAnalyses' own status (real-time subscribed in RealCaddieContext,
// same source CaddieAnalysisDetail/the old CaddieProcessingBanner already
// used) and the real caddie_analysis_complete notification row Postgres
// inserts the moment an analysis flips to 'complete' (see migration
// 20260821110000) — no new table, column, poll, or network request. Pure
// derived data with no state of its own, so it's safe to call from more
// than one place at once (BottomNav and SideNav both do).
export function useCaddieNavStatus(): CaddieNavStatus {
  const { caddieAnalyses, notifications } = useData();
  // A row the pipeline abandoned stays 'processing' forever server-side;
  // past the same stale threshold the Caddie list uses, it stops counting
  // as in-flight so the nav doesn't spin indefinitely. Not memoized: the
  // answer changes with wall-clock time, and the periodic re-render is
  // what lets the stale mark actually get noticed.
  const anyProcessing = caddieAnalyses.some((a) => a.status === "processing");
  usePeriodicRerender(anyProcessing);
  const isProcessing = caddieAnalyses.some((a) => a.status === "processing" && !isStaleProcessing(a));
  const unseenNotification = useMemo(
    () => notifications.find((n) => n.type === "caddie_analysis_complete" && !n.read),
    [notifications],
  );
  return { isProcessing, unseenNotification };
}
