import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface FoundingCohortStatus {
  cap: number;
  awardedCount: number;
  remaining: number;
  isOpen: boolean;
}

interface StatusRow {
  cap: number;
  awarded_count: number;
  remaining: number;
  is_open: boolean;
}

// Authoritative counts from get_founding_cohort_status() -- never a client
// counter. Returns null while loading, for demo accounts, and if the RPC
// fails (e.g. before the migration is applied), so callers simply render
// nothing in those cases.
export function useFoundingCohortStatus(enabled: boolean): FoundingCohortStatus | null {
  const [status, setStatus] = useState<FoundingCohortStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_founding_cohort_status");
      if (cancelled || error || !data) return;
      const row = (Array.isArray(data) ? data[0] : data) as StatusRow | undefined;
      if (!row) return;
      setStatus({ cap: row.cap, awardedCount: row.awarded_count, remaining: row.remaining, isOpen: row.is_open });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return enabled ? status : null;
}
