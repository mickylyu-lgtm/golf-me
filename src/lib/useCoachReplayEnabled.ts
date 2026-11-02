import { useAuth } from "../context/AuthContext";
import { useRoles } from "./useRoles";

// Caddie V3 Coach Replay is off for real users while it's a first cut. It is
// on for the demo account (openly fictional data, so Micky and App Review can
// see it without uploading) and for admins, via the same server-derived
// my_active_roles() check that gates /admin/dashboard. No env var or secret:
// widening the rollout later is a change to this one function.
export function useCoachReplayEnabled(): boolean {
  const { isDemo } = useAuth();
  const { isAdmin } = useRoles();
  return isDemo || isAdmin;
}
