// The one official GolfMe founder account — Micky's real, existing account
// (same one used for /admin tools), not a separate system persona: replies
// from new users land in the inbox he already checks. Stable id, never
// regenerated; mirrored in the notify_founder_welcome() DB trigger.
export const FOUNDER_USER_ID = "11be6983-7cd6-434d-bb52-6bfaf1d6e309";

export function isFounder(golferId: string): boolean {
  return golferId === FOUNDER_USER_ID;
}
