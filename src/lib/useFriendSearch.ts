import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// Search result shape from search_golfer_profiles() — deliberately narrower
// than GolferProfile (no email/phone/exact coordinates/OAuth fields, none
// of which the RPC returns in the first place — this isn't a client-side
// filter, the database function itself never selects them). Not forced into
// the full GolferProfile type, which requires many fields this result
// doesn't have.
export interface FriendSearchResult {
  id: string;
  name: string;
  username: string | null;
  avatarColor: string;
  avatarInitials: string;
  photoUrl?: string;
  handicap: number | null;
  areaLabel: string;
  completedRounds: number;
  wouldPlayAgainPct: number;
}

interface SearchRow {
  id: string;
  name: string;
  username: string | null;
  avatar_color: string;
  avatar_initials: string;
  photo_url: string | null;
  handicap: number | null;
  area_label: string;
  completed_rounds: number;
  would_play_again_pct: number;
}

const DEBOUNCE_MS = 300;

// Debounced, server-side search — never downloads every profile and filters
// client-side. Each keystroke resets the debounce timer; only the final
// query after the user pauses actually hits the database.
export function useFriendSearch(query: string) {
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const thisRequestId = ++requestIdRef.current;
    const timer = window.setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc("search_golfer_profiles", { p_query: trimmed, p_limit: 10 });
      if (thisRequestId !== requestIdRef.current) return; // a newer keystroke superseded this request
      if (rpcError) {
        setError(rpcError.message);
        setResults([]);
      } else {
        setResults(
          ((data ?? []) as SearchRow[]).map((r) => ({
            id: r.id,
            name: r.name,
            username: r.username,
            avatarColor: r.avatar_color,
            avatarInitials: r.avatar_initials,
            photoUrl: r.photo_url ?? undefined,
            handicap: r.handicap,
            areaLabel: r.area_label,
            completedRounds: r.completed_rounds,
            wouldPlayAgainPct: r.would_play_again_pct,
          })),
        );
      }
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  return { results, loading, error };
}
