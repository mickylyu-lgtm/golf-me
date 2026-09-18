import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import type { GolferProfile } from "../types";
import type { ReputationState, ReputationTierKey } from "./reputationTiers";
import { computeDemoReputationState } from "./reputationTiers";

interface ReputationStateRow {
  tier_key: ReputationTierKey;
  points: number;
  qualifying_rounds: number;
  hosted_rounds: number;
  tenure_days: number;
  next_tier_key: ReputationTierKey | null;
  points_to_next_tier: number | null;
}

// Real accounts: tier is always read live from get_reputation_state() --
// never computed or cached client-side, so it can never go stale and the
// client can never set/fake it. Demo mode: falls back to
// computeDemoReputationState's client-side mirror (see reputationTiers.ts).
export function useReputationState(golfer: GolferProfile | undefined): { loading: boolean; state: ReputationState } {
  const { isDemo } = useAuth();
  const [state, setState] = useState<ReputationState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemo || !golfer?.id) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("get_reputation_state", { p_user_id: golfer.id });
      if (cancelled) return;
      if (error || !data || !data[0]) {
        console.error("GolfMe: failed to load reputation state.", error);
        setState(null);
        return;
      }
      const row = data[0] as ReputationStateRow;
      setState({
        tierKey: row.tier_key,
        points: row.points,
        qualifyingRounds: row.qualifying_rounds,
        hostedRounds: row.hosted_rounds,
        tenureDays: row.tenure_days,
        nextTierKey: row.next_tier_key,
        pointsToNextTier: row.points_to_next_tier,
      });
    })().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, golfer?.id]);

  return {
    loading,
    state: state ?? (golfer ? computeDemoReputationState(golfer) : computeDemoReputationState(EMPTY_GOLFER_FALLBACK)),
  };
}

// Only reached if golfer is somehow undefined for a render that still calls
// this hook (React hooks rules require calling it unconditionally) -- a
// zero-activity, zero-tenure profile computes to newcomer_1, the correct
// honest default, same as a real brand-new account.
const EMPTY_GOLFER_FALLBACK: GolferProfile = {
  reputation: { completedRounds: 0, showUpRatePct: 0, wouldPlayAgainPct: 0, onTimePct: 0, respectfulPct: 0, goodPacePct: 0 },
  memberSince: new Date().toISOString(),
} as GolferProfile;
