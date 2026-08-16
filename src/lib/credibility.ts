import type { GolferProfile, HandicapAccuracy, Review } from "../types";
import { isNewAccount, monthsSince } from "./format";
import type { TranslationKey } from "../i18n/locales/en";

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// GolfMe Credibility is deliberately separate from handicap: handicap is
// skill, credibility is "how reliable and pleasant is this person to golf
// with." Computed on the fly from a golfer's seeded reputation baseline
// blended with any live reviews about them — no stored score, so it reacts
// immediately when a review is submitted without needing a background job.

export type CredibilityTier = "excellent" | "good" | "building" | "limited";

export interface CredibilityInfo {
  tier: CredibilityTier;
  label: string;
  score: number; // internal only — never render this number in the UI
}

const TIER_LABEL: Record<CredibilityTier, string> = {
  excellent: "Excellent Credibility",
  good: "Good Credibility",
  building: "Building Credibility",
  limited: "Limited History",
};

const TIER_LABEL_KEY: Record<CredibilityTier, TranslationKey> = {
  excellent: "credibility.excellent",
  good: "credibility.good",
  building: "credibility.building",
  limited: "credibility.limited",
};

// The translated label to actually render — CredibilityInfo.label (below)
// stays the fixed English string for any non-UI use; every display site
// should call this instead.
export function credibilityLabel(tier: CredibilityTier, t: TFn): string {
  return t(TIER_LABEL_KEY[tier]);
}

export function computeCredibility(golfer: GolferProfile, reviews: Review[]): CredibilityInfo {
  const rep = golfer.reputation;

  // Brand new golfers always land in "Building Credibility" regardless of
  // score math — never a bad-looking state for someone who just joined.
  if (rep.completedRounds === 0 && reviews.length === 0) {
    return { tier: "building", label: TIER_LABEL.building, score: golfer.verification.verifiedGolfer ? 10 : 5 };
  }

  const roundsFactor = Math.min(rep.completedRounds, 30) / 30;
  const monthsFactor = Math.min(monthsSince(golfer.memberSince), 12) / 12;
  const baseline =
    roundsFactor * 30 +
    (rep.showUpRatePct / 100) * 20 +
    (rep.wouldPlayAgainPct / 100) * 20 +
    (rep.onTimePct / 100) * 10 +
    (rep.respectfulPct / 100) * 10 +
    (golfer.verification.verifiedGolfer ? 5 : 0) +
    monthsFactor * 5;

  let score = baseline;
  if (reviews.length > 0) {
    const positiveRate =
      reviews.filter((r) => r.wouldPlayAgain && r.showedUp && r.respectful).length / reviews.length;
    const liveSignal = positiveRate * 100;
    // Live reviews matter more for golfers with little seed history, and
    // are naturally damped for well-established golfers — one rating
    // shouldn't swing someone with 40 completed rounds.
    const liveWeight = Math.min(reviews.length / (rep.completedRounds + reviews.length || 1), 0.4);
    score = baseline * (1 - liveWeight) + liveSignal * liveWeight;
  }

  const tier: CredibilityTier = score >= 80 ? "excellent" : score >= 55 ? "good" : score >= 30 ? "building" : "limited";
  return { tier, label: TIER_LABEL[tier], score: Math.round(score) };
}

export type HandicapConfidenceLevel = "high" | "normal" | "needs_review";

export interface HandicapConfidenceInfo {
  level: HandicapConfidenceLevel;
  uniqueReviewerCount: number;
}

// Aggregates community "was their handicap accurate?" feedback. No single
// player can move this — it takes at least two independent, mostly-negative
// reviewers before confidence drops, and repeated ratings from the same
// reviewer only ever count once.
export function computeHandicapConfidence(reviews: Review[]): HandicapConfidenceInfo {
  const latestByReviewer = new Map<string, HandicapAccuracy>();
  for (const r of reviews) latestByReviewer.set(r.reviewerId, r.handicapAccuracy);

  const opinions = Array.from(latestByReviewer.values()).filter((v) => v !== "not_sure");
  const unique = opinions.length;
  const negative = opinions.filter((v) => v === "slightly_off" || v === "very_inaccurate").length;

  if (unique === 0) return { level: "normal", uniqueReviewerCount: 0 };
  if (unique >= 2 && negative >= 2 && negative / unique > 0.5) return { level: "needs_review", uniqueReviewerCount: unique };
  if (unique >= 2 && negative === 0) return { level: "high", uniqueReviewerCount: unique };
  return { level: "normal", uniqueReviewerCount: unique };
}

export function newGolferStatusLabel(golfer: GolferProfile): string | null {
  return isNewAccount(golfer.reputation.completedRounds) ? "New Golfer" : null;
}
