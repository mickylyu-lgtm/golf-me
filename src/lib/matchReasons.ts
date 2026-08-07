import type { GolfCall } from "../types";
import type { CompatibilityBreakdown } from "./compatibility";
import { formatDate } from "./format";

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

export interface MatchFactor {
  key: "schedule" | "distance" | "skill" | "budget" | "vibe";
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

const VIBE_DESCRIPTOR: Record<string, string> = {
  "Casual & Social": "Casual players",
  Competitive: "Competitive players",
  "Beginner-Friendly": "Beginner-friendly group",
  Networking: "Networking-focused group",
  "Just Here to Golf": "Low-key, just here to golf",
};

export function callMatchReasons(call: GolfCall, breakdown: CompatibilityBreakdown): MatchFactor[] {
  const dayLabel = formatDate(call.dateISO);
  const factors: MatchFactor[] = [
    {
      key: "distance",
      score: breakdown.distance,
      positive: breakdown.distance >= 70,
      text: `${call.distanceMiles.toFixed(0)} miles away`,
    },
    {
      key: "skill",
      score: breakdown.skill,
      positive: breakdown.skill >= 70,
      text: breakdown.skill >= 70 ? "Similar skill level" : "Different skill level than you",
    },
    {
      key: "budget",
      score: breakdown.budget,
      positive: breakdown.budget >= 70,
      text: breakdown.budget >= 70 ? "Within your budget" : "Outside your usual budget",
    },
    {
      key: "vibe",
      score: breakdown.vibe,
      positive: breakdown.vibe >= 70,
      text: breakdown.vibe >= 70 ? (VIBE_DESCRIPTOR[call.vibe] ?? call.vibe) : "Different vibe than you prefer",
    },
    {
      key: "schedule",
      score: breakdown.schedule,
      positive: breakdown.schedule >= 70,
      text: breakdown.schedule >= 70 ? `Available ${dayLabel}` : "Outside your usual free time",
    },
  ];
  return pickReasons(factors);
}

export function golferMatchReasons(breakdown: CompatibilityBreakdown): MatchFactor[] {
  const factors: MatchFactor[] = [
    {
      key: "distance",
      score: breakdown.distance,
      positive: breakdown.distance >= 70,
      text: breakdown.distance >= 70 ? "Nearby" : "A bit of a drive",
    },
    {
      key: "skill",
      score: breakdown.skill,
      positive: breakdown.skill >= 70,
      text: breakdown.skill >= 70 ? "Similar handicap" : "Different skill level",
    },
    {
      key: "budget",
      score: breakdown.budget,
      positive: breakdown.budget >= 70,
      text: breakdown.budget >= 70 ? "Within your budget" : "Different budget range",
    },
    {
      key: "vibe",
      score: breakdown.vibe,
      positive: breakdown.vibe >= 70,
      text: breakdown.vibe >= 70 ? "Same golf vibe" : "Different vibe preference",
    },
    {
      key: "schedule",
      score: breakdown.schedule,
      positive: breakdown.schedule >= 70,
      text: breakdown.schedule >= 70 ? "Same availability" : "Different schedule",
    },
  ];
  return pickReasons(factors);
}
