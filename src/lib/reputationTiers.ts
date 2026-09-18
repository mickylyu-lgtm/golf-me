import type { GolferProfile } from "../types";
import { monthsSince } from "./format";
import type { TranslationKey } from "../i18n/locales/en";

// GolfMe Reputation tiers -- presentation layer only. The actual scoring
// formula and thresholds live in exactly one place: the
// get_reputation_state() Postgres function (see
// supabase/migrations/20260918170000_add_reputation_tier_system.sql). Real
// accounts always get their tier from that function via useReputationState
// below; this file never recomputes or second-guesses it.
//
// The one unavoidable exception is DEMO_TIER_THRESHOLDS below, used only to
// approximate a tier for mock/demo golfers, who have no real
// golf_calls/round_participants rows for the SQL function to read. It
// mirrors the same point values and thresholds but necessarily drops the
// anti-farming/per-round host detection the real function does, since demo
// data has no real participant graph to derive that from.

export type ReputationFamily = "newcomer" | "established" | "trusted" | "premier" | "elite";

export type ReputationTierKey =
  | "newcomer_1"
  | "newcomer_2"
  | "newcomer_3"
  | "established_1"
  | "established_2"
  | "established_3"
  | "trusted_1"
  | "trusted_2"
  | "trusted_3"
  | "premier_1"
  | "premier_2"
  | "premier_3"
  | "elite";

interface TierDef {
  family: ReputationFamily;
  subtier: 1 | 2 | 3 | null; // null for elite, which has no subtiers
  minPoints: number;
  minTenureDays: number;
}

// Order matches get_reputation_state()'s tier_order exactly (1-13).
export const TIER_ORDER: ReputationTierKey[] = [
  "newcomer_1",
  "newcomer_2",
  "newcomer_3",
  "established_1",
  "established_2",
  "established_3",
  "trusted_1",
  "trusted_2",
  "trusted_3",
  "premier_1",
  "premier_2",
  "premier_3",
  "elite",
];

export const TIER_DEFS: Record<ReputationTierKey, TierDef> = {
  newcomer_1: { family: "newcomer", subtier: 1, minPoints: 0, minTenureDays: 0 },
  newcomer_2: { family: "newcomer", subtier: 2, minPoints: 5, minTenureDays: 0 },
  newcomer_3: { family: "newcomer", subtier: 3, minPoints: 15, minTenureDays: 0 },
  established_1: { family: "established", subtier: 1, minPoints: 30, minTenureDays: 14 },
  established_2: { family: "established", subtier: 2, minPoints: 50, minTenureDays: 14 },
  established_3: { family: "established", subtier: 3, minPoints: 75, minTenureDays: 14 },
  trusted_1: { family: "trusted", subtier: 1, minPoints: 100, minTenureDays: 60 },
  trusted_2: { family: "trusted", subtier: 2, minPoints: 150, minTenureDays: 60 },
  trusted_3: { family: "trusted", subtier: 3, minPoints: 200, minTenureDays: 60 },
  premier_1: { family: "premier", subtier: 1, minPoints: 260, minTenureDays: 180 },
  premier_2: { family: "premier", subtier: 2, minPoints: 340, minTenureDays: 180 },
  premier_3: { family: "premier", subtier: 3, minPoints: 420, minTenureDays: 180 },
  elite: { family: "elite", subtier: null, minPoints: 500, minTenureDays: 365 },
};

const FAMILY_LABEL_KEY: Record<ReputationFamily, TranslationKey> = {
  newcomer: "reputation.tier.newcomer",
  established: "reputation.tier.established",
  trusted: "reputation.tier.trusted",
  premier: "reputation.tier.premier",
  elite: "reputation.tier.elite",
};

const SUBTIER_NUMERAL = ["I", "II", "III"] as const;

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function tierDisplayName(tier: ReputationTierKey, t: TFn): string {
  const def = TIER_DEFS[tier];
  const family = t(FAMILY_LABEL_KEY[def.family]);
  return def.subtier ? `${family} ${SUBTIER_NUMERAL[def.subtier - 1]}` : family;
}

export function tierFamily(tier: ReputationTierKey): ReputationFamily {
  return TIER_DEFS[tier].family;
}

// Presentation-only styling per family -- an original, restrained GolfMe
// look (lucide outline icons already used everywhere else in the app, not
// custom artwork), never Valorant-style trade dress. Escalates gray ->
// green -> blue/teal -> purple -> restrained gold, one icon step more
// "earned" per family per the brief (plain shield -> check -> half-banded
// -> award -> crown).
export const FAMILY_STYLE: Record<ReputationFamily, { iconClass: string; badgeClass: string }> = {
  newcomer: { iconClass: "text-slate-400", badgeClass: "bg-slate-100 text-slate-600" },
  established: { iconClass: "text-brand-forest", badgeClass: "bg-fairway-50 text-brand-forest" },
  trusted: { iconClass: "text-teal-600", badgeClass: "bg-teal-50 text-teal-700" },
  premier: { iconClass: "text-violet-600", badgeClass: "bg-violet-50 text-violet-700" },
  elite: { iconClass: "text-brand-gold", badgeClass: "bg-[#fdf3df] text-[#8a6a1f] ring-1 ring-inset ring-brand-gold/40" },
};

// ---- Demo-mode fallback (see file header) ----

export interface ReputationState {
  tierKey: ReputationTierKey;
  points: number;
  qualifyingRounds: number;
  hostedRounds: number;
  tenureDays: number;
  nextTierKey: ReputationTierKey | null;
  pointsToNextTier: number | null;
}

// Deliberately simple: 10 pts/completed round, no host bonus (demo data
// doesn't track who "hosted" a mock round distinctly enough to trust), no
// anti-farming cap (mock rosters are small and not adversarial). Tenure
// gates still apply so a stale demo account can't show a prestigious tier.
export function computeDemoReputationState(golfer: GolferProfile): ReputationState {
  const points = golfer.reputation.completedRounds * 10;
  const tenureDays = monthsSince(golfer.memberSince) * 30;

  let current: ReputationTierKey = "newcomer_1";
  for (const key of TIER_ORDER) {
    const def = TIER_DEFS[key];
    if (points >= def.minPoints && tenureDays >= def.minTenureDays) current = key;
  }

  const idx = TIER_ORDER.indexOf(current);
  const nextTierKey = idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
  const pointsToNextTier = nextTierKey ? Math.max(TIER_DEFS[nextTierKey].minPoints - points, 0) : null;

  return {
    tierKey: current,
    points,
    qualifyingRounds: golfer.reputation.completedRounds,
    hostedRounds: 0,
    tenureDays,
    nextTierKey,
    pointsToNextTier,
  };
}
