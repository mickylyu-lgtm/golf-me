// The two match verdicts the app shows, each a different dimension with its
// own label set, kept in one place so neither can drift into the other's
// words (desktop review 2026-11-05: Auto-Match said "EXCELLENT MATCH" above a
// card saying "Decent Match for you"; both were right, about different things).
//
// - matchTier(score): the 0-100 compatibility score from compatibility.ts
//   (schedule, distance, skill, budget, vibe). Round cards, the round page,
//   golfer profiles and golfer badges: "Great Match", "Decent Match for you".
// - preferenceTier(matchedCount): how many of the golfer's explicit Match
//   Preferences (preferenceMatch.ts) a round meets. Auto-Match's header only,
//   always worded as a *preference* match.
//
// No React or runtime imports, so tests/matchTiers.test.ts runs under node.
import type { TranslationKey } from "../i18n/locales/en";

export type MatchTier = "great" | "decent" | "possible" | "low";

export interface TierInfo {
  tier: MatchTier;
  emoji: string;
  label: string;
}

// A missing or non-numeric score is "low", never a better tier by accident.
export function matchTier(score: number): TierInfo {
  if (score >= 80) return { tier: "great", emoji: "🟢", label: "Great Match" };
  if (score >= 60) return { tier: "decent", emoji: "🟡", label: "Decent Match" };
  if (score >= 40) return { tier: "possible", emoji: "🟠", label: "Possible Match" };
  return { tier: "low", emoji: "⚪", label: "Limited Match" };
}

// "<tier> for you" as one translated phrase, so each language can order it.
export const TIER_FOR_YOU_KEYS: Record<MatchTier, TranslationKey> = {
  great: "matchTier.greatForYou",
  decent: "matchTier.decentForYou",
  possible: "matchTier.possibleForYou",
  low: "matchTier.lowForYou",
};

export type PreferenceTier = "excellent" | "great" | "good" | "none";

// Counts matched preferences, not a share of the selected ones: 3 of 3
// selected is "good", the same as 3 of 5. A missing or negative count is "none".
export function preferenceTier(matchedCount: number): PreferenceTier {
  if (matchedCount >= 5) return "excellent";
  if (matchedCount === 4) return "great";
  if (matchedCount === 3) return "good";
  return "none";
}

// Every label names its dimension ("Excellent preference match"), so it never
// reads as the round's overall verdict next to the compatibility tier.
export const PREFERENCE_TIER_KEYS: Record<Exclude<PreferenceTier, "none">, TranslationKey> = {
  excellent: "preferenceTier.excellent",
  great: "preferenceTier.great",
  good: "preferenceTier.good",
};

export function preferenceTierKey(tier: PreferenceTier): TranslationKey | null {
  return tier === "none" ? null : PREFERENCE_TIER_KEYS[tier];
}
