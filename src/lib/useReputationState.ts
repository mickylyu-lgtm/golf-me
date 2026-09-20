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

// Session-lifetime cache (resets on a full reload, survives in-app
// navigation) keyed by user id. Profile/ReputationDetail/GolferProfilePage
// all unmount on route change -- expected React Router behavior for
// distinct routes, not a bug -- which used to mean every navigate-back
// re-ran this hook from a blank slate and rendered
// computeDemoReputationState()'s client-side approximation while the real
// get_reputation_state() RPC was back in flight. That approximation
// routinely disagrees with the real, server-computed tier (no host bonus,
// no anti-farming cap, tenure via monthsSince*30 instead of real day
// counts), so real accounts would visibly flash a WRONG tier/crest before
// snapping to the right one on every single navigation -- the root cause
// of the Me -> Reputation -> Back -> Me glitch. Caching the last real
// answer per user id means every mount after the first one in a session
// renders the correct tier immediately, with no guess in between.
const realStateCache = new Map<string, ReputationState>();

// Real accounts: tier is always read live from get_reputation_state() --
// never computed or cached across sessions, so it can never go stale on
// reload and the client can never set/fake it. Within one session, a
// cache hit renders instantly while the RPC above still runs in the
// background to catch any real change since the last fetch. Demo mode:
// always the client-side mirror (see reputationTiers.ts) -- no network
// round trip to flash a wrong value in the first place.
//
// `state` is nullable for real accounts only, and only until the very
// first fetch of a session resolves (or an existing cache entry is
// found) -- callers must treat null as "not yet known," never assume
// this is a placeholder tier safe to render, since (unlike the old
// demo-approximation fallback) it deliberately isn't one.
export function useReputationState(golfer: GolferProfile | undefined): { loading: boolean; state: ReputationState | null } {
  const { isDemo } = useAuth();
  const [state, setState] = useState<ReputationState | null>(() => (golfer?.id ? (realStateCache.get(golfer.id) ?? null) : null));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemo || !golfer?.id) {
      setState(null);
      return;
    }
    const cached = realStateCache.get(golfer.id);
    if (cached) setState(cached); // instant, correct render on remount -- no fetch-in-progress flash
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("get_reputation_state", { p_user_id: golfer.id });
      if (cancelled) return;
      if (error || !data || !data[0]) {
        console.error("GolfMe: failed to load reputation state.", error);
        if (!cached) setState(null);
        return;
      }
      const row = data[0] as ReputationStateRow;
      const next: ReputationState = {
        tierKey: row.tier_key,
        points: row.points,
        qualifyingRounds: row.qualifying_rounds,
        hostedRounds: row.hosted_rounds,
        tenureDays: row.tenure_days,
        nextTierKey: row.next_tier_key,
        pointsToNextTier: row.points_to_next_tier,
      };
      realStateCache.set(golfer.id, next);
      setState(next);
    })().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, golfer?.id]);

  if (isDemo) {
    return { loading: false, state: computeDemoReputationState(golfer ?? EMPTY_GOLFER_FALLBACK) };
  }
  return { loading, state };
}

// Only reached if golfer is somehow undefined for a render that still calls
// this hook (React hooks rules require calling it unconditionally) -- a
// zero-activity, zero-tenure profile computes to newcomer_1, the correct
// honest default, same as a real brand-new account. Demo mode only.
const EMPTY_GOLFER_FALLBACK: GolferProfile = {
  reputation: { completedRounds: 0, showUpRatePct: 0, wouldPlayAgainPct: 0, onTimePct: 0, respectfulPct: 0, goodPacePct: 0 },
  memberSince: new Date().toISOString(),
} as GolferProfile;
