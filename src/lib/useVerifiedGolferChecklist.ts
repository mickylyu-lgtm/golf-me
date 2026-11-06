import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import type { GolferProfile } from "../types";
import {
  VERIFIED_GOLFER_RPC,
  checklistFromRow,
  demoChecklist,
  isMissingVerifiedGolferRpc,
  type VerifiedGolferChecklist,
  type VerifiedGolferStatusRow,
} from "./verifiedGolfer";

// "unavailable" = the migration isn't applied yet (or the call failed): the
// Reputation screen then keeps its pre-migration behaviour for real accounts
// (no Verified Golfer block at all), never a guessed checklist.
export type VerifiedGolferChecklistState =
  | { status: "loading"; checklist: null }
  | { status: "ready"; checklist: VerifiedGolferChecklist }
  | { status: "unavailable"; checklist: null };

export function useVerifiedGolferChecklist(
  currentUser: GolferProfile,
  qualifyingRounds: number | null,
): VerifiedGolferChecklistState {
  const { isDemo, authUser, refreshProfile } = useAuth();
  const [real, setReal] = useState<VerifiedGolferChecklistState>({ status: "loading", checklist: null });
  const storedBadge = currentUser.verification.verifiedGolfer;

  useEffect(() => {
    if (isDemo || !authUser?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc(VERIFIED_GOLFER_RPC);
      if (cancelled) return;
      if (error) {
        if (!isMissingVerifiedGolferRpc(error)) console.error("GolfMe: failed to load Verified Golfer status.", error);
        setReal({ status: "unavailable", checklist: null });
        return;
      }
      const row = Array.isArray(data) ? (data[0] as VerifiedGolferStatusRow | undefined) : (data as VerifiedGolferStatusRow | null);
      const checklist = checklistFromRow(row);
      setReal(checklist ? { status: "ready", checklist } : { status: "unavailable", checklist: null });
    })();
    return () => {
      cancelled = true;
    };
    // Re-ask when the photo changes (the server re-derives the badge on that write).
  }, [isDemo, authUser?.id, currentUser.photoUrl]);

  // The RPC also heals the stored column; pull the profile again when it
  // disagrees with what this session loaded, so the badge on the golfer's own
  // profile/cards matches.
  const serverVerified = real.status === "ready" ? real.checklist.verified : null;
  useEffect(() => {
    if (isDemo || serverVerified === null || serverVerified === storedBadge) return;
    refreshProfile().catch(() => {});
  }, [isDemo, serverVerified, storedBadge, refreshProfile]);

  if (isDemo) {
    return {
      status: "ready",
      checklist: demoChecklist({
        emailVerified: currentUser.verification.emailVerified,
        photoUrl: currentUser.photoUrl,
        qualifyingRounds: qualifyingRounds ?? 0,
      }),
    };
  }
  return real;
}
