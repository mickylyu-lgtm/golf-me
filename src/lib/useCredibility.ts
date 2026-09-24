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

// Session-lifetime cache keyed by user id, so list surfaces (golfer cards,
// the join modal's roster) don't re-fetch every golfer on every mount. A
// cache hit renders immediately; the hook still re-fetches in the
// background to pick up changes. Same approach as useReputationState.
const rowCache = new Map<string, CredibilityStatsRow>();

// In-flight requests keyed by user id, so a list hook and the per-card hook
// asking for the same golfer at the same moment share one RPC.
const inFlight = new Map<string, Promise<CredibilityStatsRow | null>>();

function fetchCredibilityRow(golferId: string): Promise<CredibilityStatsRow | null> {
  const pending = inFlight.get(golferId);
  if (pending) return pending;
  const request = (async () => {
    const { data, error } = await supabase.rpc("get_credibility_stats", { p_user_id: golferId });
    if (error || !data || !data[0]) {
      console.error("GolfMe: failed to load credibility stats.", error);
      return null;
    }
    const row = data[0] as CredibilityStatsRow;
    rowCache.set(golferId, row);
    return row;
  })().finally(() => inFlight.delete(golferId));
  inFlight.set(golferId, request);
  return request;
}

function rowToCredibility(row: CredibilityStatsRow, baselineReputation: GolferProfile["reputation"]): RealCredibility {
  return {
    reputation: {
      completedRounds: row.completed_rounds,
      showUpRatePct: row.show_up_pct,
      wouldPlayAgainPct: row.would_play_again_pct,
      onTimePct: row.on_time_pct,
      respectfulPct: row.respectful_pct,
      goodPacePct: baselineReputation.goodPacePct, // not tracked server-side yet — stays a real (not fabricated) 0
    },
    handicapConfidence: { level: row.handicap_confidence, uniqueReviewerCount: row.reviews_received },
  };
}

// Real accounts never expose raw review rows for anyone but the reviewer
// (see round_reviews' RLS) — get_credibility_stats() is the only real-mode
// path to another golfer's credibility, and it only ever returns rounded
// aggregates, never who-said-what. Demo mode never calls this; its
// existing computeCredibility(golfer, reviews) already works unchanged.
export function useCredibilityStats(golferId: string | undefined, baselineReputation: GolferProfile["reputation"]) {
  const { isDemo } = useAuth();
  const [stats, setStats] = useState<RealCredibility | null>(() => {
    const cached = golferId ? rowCache.get(golferId) : undefined;
    return cached ? rowToCredibility(cached, baselineReputation) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemo || !golferId) {
      setStats(null);
      return;
    }
    let cancelled = false;
    const cached = rowCache.get(golferId);
    if (cached) setStats(rowToCredibility(cached, baselineReputation));
    setLoading(true);
    fetchCredibilityRow(golferId)
      .then((row) => {
        if (cancelled) return;
        if (row) setStats(rowToCredibility(row, baselineReputation));
        else if (!cached) setStats(null);
      })
      .finally(() => !cancelled && setLoading(false));
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

// Server credibility for a small group of golfers at once (e.g. a round's
// roster, 2-4 people) — a per-golfer hook can't be called in a loop.
// Returns id -> reputation, falling back to each golfer's baseline (demo,
// still loading, or a failed fetch).
export function useCredibilityForGolfers(golfers: GolferProfile[]): Record<string, GolferProfile["reputation"]> {
  const { isDemo } = useAuth();
  const idsKey = golfers.map((g) => g.id).join(",");
  const [rows, setRows] = useState<Record<string, CredibilityStatsRow>>(() => {
    const initial: Record<string, CredibilityStatsRow> = {};
    for (const g of golfers) {
      const cached = rowCache.get(g.id);
      if (cached) initial[g.id] = cached;
    }
    return initial;
  });

  useEffect(() => {
    if (isDemo || !idsKey) return;
    let cancelled = false;
    const ids = idsKey.split(",");
    Promise.all(ids.map((id) => fetchCredibilityRow(id).then((row) => [id, row] as const))).then((results) => {
      if (cancelled) return;
      setRows((prev) => {
        const next = { ...prev };
        for (const [id, row] of results) if (row) next[id] = row;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, idsKey]);

  const result: Record<string, GolferProfile["reputation"]> = {};
  for (const g of golfers) {
    const row = isDemo ? undefined : rows[g.id];
    result[g.id] = row ? rowToCredibility(row, g.reputation).reputation : g.reputation;
  }
  return result;
}
