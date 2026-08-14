import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import type { GolferProfile } from "../types";
import type { HandicapConfidenceInfo } from "./credibility";

interface CredibilityStatsRow {
  completed_rounds: number;
  would_play_again_pct: number;
  show_up_pct: number;
  on_time_pct: number;
  respectful_pct: number;
  handicap_confidence: "high" | "normal" | "needs_review";
  reviews_received: number;
}

interface RealCredibility {
  reputation: GolferProfile["reputation"];
  handicapConfidence: HandicapConfidenceInfo;
}

// Real accounts never expose raw review rows for anyone but the reviewer
// (see round_reviews' RLS) — get_credibility_stats() is the only real-mode
// path to another golfer's credibility, and it only ever returns rounded
// aggregates, never who-said-what. Demo mode never calls this; its
// existing computeCredibility(golfer, reviews) already works unchanged.
export function useCredibilityStats(golferId: string | undefined, baselineReputation: GolferProfile["reputation"]) {
  const { isDemo } = useAuth();
  const [stats, setStats] = useState<RealCredibility | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemo || !golferId) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("get_credibility_stats", { p_user_id: golferId });
      if (cancelled) return;
      if (error || !data || !data[0]) {
        console.error("Golf Me: failed to load credibility stats.", error);
        setStats(null);
        return;
      }
      const row = data[0] as CredibilityStatsRow;
      setStats({
        reputation: {
          completedRounds: row.completed_rounds,
          showUpRatePct: row.show_up_pct,
          wouldPlayAgainPct: row.would_play_again_pct,
          onTimePct: row.on_time_pct,
          respectfulPct: row.respectful_pct,
          goodPacePct: baselineReputation.goodPacePct, // not tracked server-side yet — stays a real (not fabricated) 0
        },
        handicapConfidence: { level: row.handicap_confidence, uniqueReviewerCount: row.reviews_received },
      });
    })().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, golferId]);

  return {
    loading,
    reputation: stats?.reputation ?? baselineReputation,
    handicapConfidence: stats?.handicapConfidence,
  };
}
