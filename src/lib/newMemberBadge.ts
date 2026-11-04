// The "New to GolfMe" badge: a golfer's first 30 days, ended early by their
// first completed round, never on the founder (Micky, 2026-11-04: it used to
// last until 3 completed rounds, so almost everyone kept it for good). A
// missing or unreadable join date shows no badge rather than a permanent one.
// No imports, so tests/newMemberBadge.test.ts runs under plain node.

// How long the badge shows after joining.
export const NEW_MEMBER_BADGE_DAYS = 30;

export function showNewMemberBadge(
  golfer: { memberSince?: string; reputation: { completedRounds: number } },
  isFounder: boolean,
  now: number = Date.now(),
): boolean {
  if (isFounder || golfer.reputation.completedRounds > 0 || !golfer.memberSince) return false;
  const joined = Date.parse(golfer.memberSince);
  if (Number.isNaN(joined)) return false;
  return now - joined < NEW_MEMBER_BADGE_DAYS * 24 * 60 * 60 * 1000;
}
