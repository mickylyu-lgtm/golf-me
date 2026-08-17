import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { TeeTime } from "../services/teeTimes/types";

export class TeeTimeFetchError extends Error {}

interface GetTeeTimesResponse {
  course: string;
  courseName: string;
  holes: 9 | 18;
  date: string;
  teeTimes: TeeTime[];
  provider: string;
  bookingUrl: string;
  liveAvailability: boolean;
  message?: string;
  lastUpdated: string;
  error?: string;
}

// Real accounts and demo accounts alike hit the get-tee-times Edge Function
// — there's no mock tee-time data to branch to, since the whole point is
// never fabricating availability (see supabase/functions/get-tee-times).
export function useTeeTimes(courseId: string | null, date: string | null) {
  const [data, setData] = useState<GetTeeTimesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!courseId || !date) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.functions
      .invoke(`get-tee-times?course=${encodeURIComponent(courseId)}&date=${encodeURIComponent(date)}`, { method: "GET" })
      .then(({ data: body, error: invokeError }) => {
        if (cancelled) return;
        if (invokeError) throw new TeeTimeFetchError(invokeError.message || "Couldn't load tee times. Please try again.");
        const res = body as GetTeeTimesResponse;
        if (res.error) throw new TeeTimeFetchError(res.error);
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't load tee times. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, date, reloadToken]);

  return { data, loading, error, retry };
}
