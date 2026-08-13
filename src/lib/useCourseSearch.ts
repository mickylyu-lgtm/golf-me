import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { PlayingArea } from "./geo";
import { getNearbyCourses as getNearbyCoursesMock, searchCourses as searchCoursesMock } from "./courseSearch";
import { getNearbyRealCourses, searchRealCourses, CourseSearchError } from "./realCourseSearch";

// Minimal shape both courseSearch.ts's mock CourseResult and
// realCourseSearch.ts's RealCourseResult already satisfy structurally — the
// hooks below never need to know which one they're holding.
export interface DisplayCourseResult {
  id?: string; // courses.id — only present for real (Geoapify-backed) results
  name: string;
  area?: string;
  distanceMiles?: number;
  lat?: number;
  lng?: number;
}

interface CourseSearchState {
  results: DisplayCourseResult[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof CourseSearchError ? err.message : fallback;
}

// Demo accounts stay on the static fixture (synchronous, never fails).
// Real accounts hit the Geoapify-backed Edge Function — real network call,
// real loading/error states, never a silent fallback to fixture data (see
// Phase 3's "never silently fall back to fake course lists" requirement).
export function useNearbyCourses(location: PlayingArea | undefined, radiusMiles: number): CourseSearchState {
  const { isDemo } = useAuth();
  const [results, setResults] = useState<DisplayCourseResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const lat = location?.coords?.lat;
  const lng = location?.coords?.lng;

  useEffect(() => {
    if (lat == null || lng == null) {
      setResults([]);
      setError(null);
      return;
    }
    if (isDemo) {
      setResults(getNearbyCoursesMock(location!, radiusMiles));
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getNearbyRealCourses(location!, radiusMiles)
      .then((r) => !cancelled && setResults(r))
      .catch((err) => !cancelled && setError(errorMessage(err, "Couldn't load nearby courses.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, lat, lng, radiusMiles, retryNonce]);

  return { results, loading, error, retry: () => setRetryNonce((n) => n + 1) };
}

// Debounced (300ms) so a real account's free-text search doesn't fire a
// network request per keystroke.
export function useCourseTextSearch(query: string, location: PlayingArea | undefined, limit = 8): CourseSearchState {
  const { isDemo } = useAuth();
  const [results, setResults] = useState<DisplayCourseResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const trimmed = query.trim();
  const lat = location?.coords?.lat;
  const lng = location?.coords?.lng;

  useEffect(() => {
    if (!trimmed) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (isDemo) {
      setResults(searchCoursesMock(trimmed, location, limit));
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = window.setTimeout(() => {
      searchRealCourses(trimmed, location, limit)
        .then((r) => !cancelled && setResults(r))
        .catch((err) => !cancelled && setError(errorMessage(err, "Course search failed.")))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, trimmed, lat, lng, limit, retryNonce]);

  return { results, loading, error, retry: () => setRetryNonce((n) => n + 1) };
}
