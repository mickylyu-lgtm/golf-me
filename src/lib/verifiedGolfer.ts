// Verified Golfer badge (rule from 2026-11-06, migration 20261107230000):
//   a confirmed email OR an Apple / Google sign-in identity
//   + a profile photo
//   + at least 1 qualifying completed round (the frozen Reputation definition).
//
// Real accounts: the badge is profiles.verified_golfer, derived in Postgres and
// never client-settable; the checklist comes from get_my_verified_golfer_status()
// (the caller's own booleans only). This file only shapes data and, for demo
// mode, mirrors the rule over the demo account's local state.

export interface VerifiedGolferChecklist {
  verified: boolean;
  identityConfirmed: boolean;
  hasPhoto: boolean;
  hasQualifyingRound: boolean;
}

export interface VerifiedGolferStatusRow {
  verified: boolean | null;
  identity_confirmed: boolean | null;
  has_photo: boolean | null;
  has_qualifying_round: boolean | null;
}

export const VERIFIED_GOLFER_RPC = "get_my_verified_golfer_status";

export function checklistFromRow(row: VerifiedGolferStatusRow | null | undefined): VerifiedGolferChecklist | null {
  if (!row) return null;
  return {
    verified: row.verified === true,
    identityConfirmed: row.identity_confirmed === true,
    hasPhoto: row.has_photo === true,
    hasQualifyingRound: row.has_qualifying_round === true,
  };
}

export function hasProfilePhoto(photoUrl: string | null | undefined): boolean {
  return typeof photoUrl === "string" && photoUrl.trim() !== "";
}

// Demo mode only: the same three criteria over the demo account's local,
// fabricated state (demo never talks to Supabase).
export function demoChecklist(input: { emailVerified: boolean; photoUrl?: string | null; qualifyingRounds: number }): VerifiedGolferChecklist {
  const identityConfirmed = input.emailVerified;
  const hasPhoto = hasProfilePhoto(input.photoUrl);
  const hasQualifyingRound = input.qualifyingRounds >= 1;
  return { verified: identityConfirmed && hasPhoto && hasQualifyingRound, identityConfirmed, hasPhoto, hasQualifyingRound };
}

// PostgREST answers PGRST202 when the function isn't in its schema cache
// (migration not applied yet); Postgres itself says 42883. Anything else
// (offline, timeout) is a transient failure, not "missing".
export function isMissingVerifiedGolferRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return typeof error.message === "string" && error.message.includes(VERIFIED_GOLFER_RPC) && /could not find|does not exist/i.test(error.message);
}
