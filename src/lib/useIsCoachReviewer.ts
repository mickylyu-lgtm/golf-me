import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";

// Whether the given profile currently holds the coach_reviewer role — for
// the small badge shown wherever that profile is viewed (own profile or
// someone else's). Real accounts only; demo has no roles to check.
export function useIsCoachReviewer(userId: string | undefined) {
  const { isDemo } = useAuth();
  const [isCoachReviewer, setIsCoachReviewer] = useState(false);

  useEffect(() => {
    if (isDemo || !userId) {
      setIsCoachReviewer(false);
      return;
    }
    let cancelled = false;
    supabase.rpc("is_coach_reviewer", { p_user_id: userId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("Golf Me: failed to check coach reviewer status.", error);
        setIsCoachReviewer(false);
      } else {
        setIsCoachReviewer(Boolean(data));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, userId]);

  return isCoachReviewer;
}
