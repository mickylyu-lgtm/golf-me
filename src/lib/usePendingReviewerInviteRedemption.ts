import { useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

// Shared with CoachInvite.tsx, which writes this the moment someone lands
// on a /coach-invite/:token link, whether or not they're signed in yet.
export const PENDING_REVIEWER_INVITE_KEY = "golfme:pendingReviewerInvite";

// Redeems a stored invite token the moment a real account becomes
// available — covers both "already had an account, just logged in" and
// "brand new account, redirected mid-onboarding" without CoachInvite.tsx
// itself needing to be revisited (onboarding lands on /ready, not back on
// the invite link). Runs once per token: the storage key is cleared as
// soon as an attempt is made, win or lose, so a bad/expired token is never
// retried in a loop.
export function usePendingReviewerInviteRedemption() {
  const { authUser, isDemo } = useAuth();
  const { showToast } = useToast();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || isDemo || !authUser) return;
    const token = typeof window !== "undefined" ? window.sessionStorage.getItem(PENDING_REVIEWER_INVITE_KEY) : null;
    if (!token) return;
    attempted.current = true;
    window.sessionStorage.removeItem(PENDING_REVIEWER_INVITE_KEY);
    supabase.rpc("redeem_reviewer_invite", { p_token: token }).then(({ error }) => {
      if (error) {
        showToast(error.message, "warning");
      } else {
        showToast("You're now a Coach Reviewer!", "success");
      }
    });
  }, [authUser, isDemo, showToast]);
}
