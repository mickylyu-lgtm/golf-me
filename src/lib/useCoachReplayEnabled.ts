// Caddie V3 Coach Replay is on for every account (Micky, 2026-11-02: "push to
// main for all users"), after the first cut ran demo + admins only. Kept as a
// hook so turning it off again, or narrowing it back to isDemo || isAdmin via
// useAuth/useRoles, is a change to this one function.
export function useCoachReplayEnabled(): boolean {
  return true;
}
