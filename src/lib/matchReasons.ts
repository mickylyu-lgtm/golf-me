import type { GolfCall } from "../types";
import type { CompatibilityBreakdown } from "./compatibility";
import { formatDate } from "./format";
import { roundedMiles } from "./geo";
import type { Locale } from "../i18n/LocaleContext";
import type { TranslationKey } from "../i18n/locales/en";

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export type MatchTier = "great" | "decent" | "possible" | "low";

export interface TierInfo {
  tier: MatchTier;
  emoji: string;
  label: string;
}

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

export interface MatchFactor {
  key: "schedule" | "distance" | "skill" | "budget" | "vibe" | "coursePreference" | "credibility";
  score: number;
  positive: boolean;
  text: string;
}

// Picks the most tellable subset of factors: top positives first, plus the
// single weakest factor as a caveat when it's notably low — mirrors how a
// person would actually explain "why this is a good/decent match" rather
// than dumping all five signals every time.
function pickReasons(factors: MatchFactor[]): MatchFactor[] {
  const positives = factors.filter((f) => f.score >= 70).sort((a, b) => b.score - a.score);
  const negatives = factors.filter((f) => f.score < 60).sort((a, b) => a.score - b.score);

  const shown = positives.slice(0, 3);
  if (negatives.length > 0 && shown.length < 4) shown.push(negatives[0]);
  if (shown.length === 0) shown.push(...[...factors].sort((a, b) => b.score - a.score).slice(0, 3));

  return shown.slice(0, 4);
}

const VIBE_DESCRIPTOR: Record<string, TranslationKey> = {
  "Casual & Social": "matchReason.vibeCasual",
  Competitive: "matchReason.vibeCompetitive",
  "Beginner-Friendly": "matchReason.vibeBeginner",
  Networking: "matchReason.vibeNetworking",
  "Just Here to Golf": "matchReason.vibeJustGolf",
};

export function callMatchReasons(call: GolfCall, breakdown: CompatibilityBreakdown, locale: Locale, t: TFn): MatchFactor[] {
  const dayLabel = formatDate(call.dateISO, locale, t);
  const factors: MatchFactor[] = [];

  // Only surfaced when the golfer actually has course preferences set
  // (score is neutral/70 otherwise) — and listed first since it's the most
  // distinctive signal when it's a hit.
  if (breakdown.coursePreference !== undefined && breakdown.coursePreference !== 70) {
    factors.push({
      key: "coursePreference",
      score: breakdown.coursePreference,
      positive: breakdown.coursePreference >= 70,
      text: breakdown.coursePreference >= 70 ? t("matchReason.preferredCourse") : t("matchReason.notPreferredCourse"),
    });
  }

  // Omitted entirely (rather than shown with a fabricated number) when the
  // course's coordinates aren't known yet.
  if (call.distanceMiles !== undefined) {
    factors.push({
      key: "distance",
      score: breakdown.distance,
      positive: breakdown.distance >= 70,
      text: t("matchReason.milesAway", { miles: roundedMiles(call.distanceMiles) }),
    });
  }

  factors.push(
    {
      key: "skill",
      score: breakdown.skill,
      positive: breakdown.skill >= 70,
      text: breakdown.skill >= 70 ? t("matchReason.similarSkill") : t("matchReason.differentSkill"),
    },
    {
      key: "budget",
      score: breakdown.budget,
      positive: breakdown.budget >= 70,
      text: breakdown.budget >= 70 ? t("matchReason.withinBudget") : t("matchReason.outsideBudget"),
    },
    {
      key: "vibe",
      score: breakdown.vibe,
      positive: breakdown.vibe >= 70,
      text: breakdown.vibe >= 70 ? (VIBE_DESCRIPTOR[call.vibe] ? t(VIBE_DESCRIPTOR[call.vibe]) : call.vibe) : t("matchReason.differentVibe"),
    },
    {
      key: "schedule",
      score: breakdown.schedule,
      positive: breakdown.schedule >= 70,
      text: breakdown.schedule >= 70 ? t("matchReason.availableOn", { day: dayLabel }) : t("matchReason.outsideFreeTime"),
    },
  );
  return pickReasons(factors);
}

// distanceLabel: from lib/publicDirectory golferDistanceLabel (a range for
// a server bucket, whole miles for a real distance). Unknown distance drops
// the distance reason entirely: distanceScore scores it a neutral 50, which
// used to read as "A bit of a drive" for someone whose distance nobody knew.
export function golferMatchReasons(breakdown: CompatibilityBreakdown, t: TFn, distanceLabel?: string): MatchFactor[] {
  const factors: MatchFactor[] = [
    ...(distanceLabel === undefined
      ? []
      : [
          {
            key: "distance" as const,
            score: breakdown.distance,
            positive: breakdown.distance >= 70,
            text: distanceLabel,
          },
        ]),
    {
      key: "skill",
      score: breakdown.skill,
      positive: breakdown.skill >= 70,
      text: breakdown.skill >= 70 ? t("matchReason.golferSimilarHandicap") : t("matchReason.golferDifferentSkill"),
    },
    {
      key: "budget",
      score: breakdown.budget,
      positive: breakdown.budget >= 70,
      text: breakdown.budget >= 70 ? t("matchReason.withinBudget") : t("matchReason.golferDifferentBudget"),
    },
    {
      key: "vibe",
      score: breakdown.vibe,
      positive: breakdown.vibe >= 70,
      text: breakdown.vibe >= 70 ? t("matchReason.golferSameVibe") : t("matchReason.golferDifferentVibe"),
    },
    {
      key: "schedule",
      score: breakdown.schedule,
      positive: breakdown.schedule >= 70,
      text: breakdown.schedule >= 70 ? t("matchReason.golferSameAvailability") : t("matchReason.golferDifferentSchedule"),
    },
  ];
  return pickReasons(factors);
}
