import { useEffect, useRef } from "react";
import { useData } from "../../context/DataContext";
import { newlyCompletedIds, processingIds } from "../../lib/caddieDoneHaptic";
import { tapHaptic } from "../../lib/tapFeedback";

// One success haptic when a Caddie analysis finishes while the app is open,
// on whatever screen the golfer is on, so they notice it's ready (the nav
// icon's pulse is easy to miss). Mounted once in AppShell. Reads the same
// caddieAnalyses the nav icon does; nothing new is fetched or stored. If the
// app was in the background, the haptic lands when the refreshed rows
// arrive on return. Native app only (tapHaptic does nothing on the web).
export function CaddieDoneHaptic() {
  const { caddieAnalyses } = useData();
  const previousRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (newlyCompletedIds(previousRef.current, caddieAnalyses).length > 0) tapHaptic("success");
    previousRef.current = processingIds(caddieAnalyses);
  }, [caddieAnalyses]);

  return null;
}
