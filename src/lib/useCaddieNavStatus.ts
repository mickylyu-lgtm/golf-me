import { useMemo } from "react";
import { useData } from "../context/DataContext";
import type { AppNotification } from "../types";

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
  const isProcessing = useMemo(() => caddieAnalyses.some((a) => a.status === "processing"), [caddieAnalyses]);
  const unseenNotification = useMemo(
    () => notifications.find((n) => n.type === "caddie_analysis_complete" && !n.read),
    [notifications],
  );
  return { isProcessing, unseenNotification };
}
