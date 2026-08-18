import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";

// Server-derived only — never a client-cached flag. Every mount re-asks
// my_active_roles() (SECURITY DEFINER, reads auth.uid()'s own user_roles
// rows), so a role granted or revoked from the admin dashboard takes effect
// the next time this hook runs, not just on next login. Demo mode never
// has real roles (no real auth.uid() session for the RPC to check).
export function useRoles() {
  const { isDemo, authUser } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const selfId = authUser?.id;

  const refresh = useCallback(async () => {
    if (isDemo || !selfId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("my_active_roles");
    if (error) {
      console.error("Golf Me: failed to load account roles.", error);
      setRoles([]);
    } else {
      setRoles((data ?? []) as string[]);
    }
    setLoading(false);
  }, [isDemo, selfId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    isCoachReviewer: roles.includes("coach_reviewer"),
    refresh,
  };
}
