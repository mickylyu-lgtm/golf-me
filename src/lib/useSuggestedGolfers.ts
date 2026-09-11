import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { FriendSearchResult } from "./useFriendSearch";

// suggested_golfer_profiles() returns the exact same row shape as
// search_golfer_profiles() (see the migration comment) -- reusing
// FriendSearchResult here instead of a second interface.
interface SuggestionRow {
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

const SUGGESTION_LIMIT = 6;

// Fetched once per FindFriends visit, independent of the search query --
// ranking (handicap/vibe/location closeness, falling back to most-recently-
// joined) is computed server-side and doesn't change while the golfer types
// and clears the search field, so there's nothing to react to here.
export function useSuggestedGolfers() {
  const [suggestions, setSuggestions] = useState<FriendSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc("suggested_golfer_profiles", { p_limit: SUGGESTION_LIMIT });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setSuggestions([]);
      } else {
        setSuggestions(
          ((data ?? []) as SuggestionRow[]).map((r) => ({
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { suggestions, loading, error };
}
