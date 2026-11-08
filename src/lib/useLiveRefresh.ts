import { useCallback, useEffect, useRef, useState } from "react";
import { LIVE_INTERVAL_MS, NOT_SET_UP_INTERVAL_MS, liveStatus, nextDelayMs } from "./adminAnalytics";
import type { LiveStatus } from "./adminAnalytics";

// Restrained foreground refresh for the admin dashboard (no Realtime
// subscription: the numbers come from aggregate RPCs, and most source tables
// aren't readable row-by-row by the admin through RLS anyway).
//   - runs `refresh` every 30 s while the page is visible;
//   - after consecutive failures waits 60 s, 120 s, ... up to 5 min;
//   - "not set up" (migration missing) checks again every 5 min only;
//   - stops while the page is hidden, refreshes at once when it's visible again;
//   - runs again at once when `refresh` itself changes (e.g. a new date range);
//   - never overlaps two refreshes (a request made mid-flight runs right after).
// "skip" = nothing to ask (e.g. an invalid custom range): no state change.
export type RefreshOutcome = "ok" | "error" | "not_set_up" | "skip";

export function useLiveRefresh(refresh: () => Promise<RefreshOutcome>, opts: { enabled: boolean; intervalMs?: number }) {
  const interval = opts.intervalMs ?? LIVE_INTERVAL_MS;
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const [notSetUp, setNotSetUp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const failures = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refresh);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const run = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    clear();
    let outcome: RefreshOutcome = "error";
    try {
      outcome = await refreshRef.current();
    } catch {
      outcome = "error";
    }
    inFlight.current = false;
    setRefreshing(false);
    if (outcome !== "skip") setNotSetUp(outcome === "not_set_up");
    if (outcome === "ok") {
      failures.current = 0;
      setLastSuccessAt(Date.now());
    } else if (outcome === "error") {
      failures.current += 1;
    }
    if (queued.current) {
      queued.current = false;
      void run();
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const delay = outcome === "not_set_up" ? NOT_SET_UP_INTERVAL_MS : nextDelayMs(failures.current, interval);
    timer.current = setTimeout(() => void run(), delay);
  }, [interval]);

  // New refresh function (new range): use it, and run it now.
  useEffect(() => {
    if (refreshRef.current === refresh) return;
    refreshRef.current = refresh;
    if (opts.enabled) void run();
  }, [refresh, opts.enabled, run]);

  useEffect(() => {
    if (!opts.enabled) return;
    void run();
    const onVisibility = () => {
      const isHidden = document.visibilityState === "hidden";
      setHidden(isHidden);
      if (isHidden) clear();
      else void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A 5 s clock only for the "updated 12s ago" label and the stale check.
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(tick);
      clear();
    };
  }, [opts.enabled, run]);

  const status: LiveStatus = liveStatus({ hidden, lastSuccessAt, now, notSetUp, intervalMs: interval });
  return { status, lastSuccessAt, now, refreshing, refreshNow: run };
}
