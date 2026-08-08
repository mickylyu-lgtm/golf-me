import type { GolfCall, GolferProfile } from "../types";
import { skillTierFromHandicap } from "./format";
import { callToAvailabilitySlot } from "./availability";

// Golf Compatibility Score: a weighted blend of schedule overlap, distance,
// skill closeness, budget overlap, and playing-style (vibe) match.
// Equal weighting (20% each) keeps the score easy to reason about and easy
// to re-tune later once real usage data exists.

const WEIGHTS = {
  schedule: 0.2,
  distance: 0.2,
  skill: 0.2,
  budget: 0.2,
  vibe: 0.2,
};

function scheduleScore(a: GolferProfile, b: GolferProfile): number {
  if (a.availability.length === 0 || b.availability.length === 0) return 40;
  const shared = a.availability.filter((slot) => b.availability.includes(slot));
  const ratio = shared.length / Math.min(a.availability.length, b.availability.length);
  return Math.round(ratio * 100);
}

function distanceScore(distanceMiles: number): number {
  if (distanceMiles <= 5) return 100;
  if (distanceMiles <= 10) return 85;
  if (distanceMiles <= 15) return 70;
  if (distanceMiles <= 25) return 50;
  return 30;
}

function skillScore(a: GolferProfile, b: GolferProfile): number {
  // Treat "no handicap" as a wide beginner band centered around 30.
  const ha = a.handicap ?? 30;
  const hb = b.handicap ?? 30;
  const diff = Math.abs(ha - hb);
  if (diff <= 3) return 100;
  if (diff <= 7) return 85;
  if (diff <= 12) return 65;
  if (diff <= 20) return 45;
  return 25;
}

function budgetScore(a: GolferProfile, b: GolferProfile): number {
  const overlapLow = Math.max(a.budgetMin, b.budgetMin);
  const overlapHigh = Math.min(a.budgetMax, b.budgetMax);
  if (overlapHigh < overlapLow) {
    // No overlap — score based on how far apart the ranges are.
    const gap = overlapLow - overlapHigh;
    return Math.max(20, 60 - gap);
  }
  const overlapSize = overlapHigh - overlapLow;
  const widestRange = Math.max(a.budgetMax - a.budgetMin, b.budgetMax - b.budgetMin, 1);
  return Math.round(60 + Math.min(1, overlapSize / widestRange) * 40);
}

function vibeScore(a: GolferProfile, b: GolferProfile): number {
  if (a.vibes[0] && a.vibes[0] === b.vibes[0]) return 100;
  const shared = a.vibes.some((v) => b.vibes.includes(v));
  if (shared) return 75;
  return 40;
}

export interface CompatibilityBreakdown {
  overall: number;
  schedule: number;
  distance: number;
  skill: number;
  budget: number;
  vibe: number;
  coursePreference?: number; // only meaningful for user-vs-call comparisons
}

export function computeCompatibility(current: GolferProfile, candidate: GolferProfile): CompatibilityBreakdown {
  const schedule = scheduleScore(current, candidate);
  const distance = distanceScore(candidate.distanceMiles);
  const skill = skillScore(current, candidate);
  const budget = budgetScore(current, candidate);
  const vibe = vibeScore(current, candidate);

  const overall = Math.round(
    schedule * WEIGHTS.schedule +
      distance * WEIGHTS.distance +
      skill * WEIGHTS.skill +
      budget * WEIGHTS.budget +
      vibe * WEIGHTS.vibe,
  );

  return { overall, schedule, distance, skill, budget, vibe };
}

// Round-level compatibility: how well a Golf Call fits a golfer, using the
// same five signals but read off the call's own fields (skill preference,
// price, vibe, day-part, course distance) instead of another profile's
// ranges. Same equal-weight blend — deliberately simple.

const SKILL_TIERS = ["Beginner", "Intermediate", "Advanced"] as const;

function callSkillScore(user: GolferProfile, call: GolfCall): number {
  if (call.skillLevel === "Any Skill Level") return 90;
  const userTier = skillTierFromHandicap(user.handicap);
  const userIdx = SKILL_TIERS.indexOf(userTier);
  const callIdx = SKILL_TIERS.indexOf(call.skillLevel as (typeof SKILL_TIERS)[number]);
  const diff = Math.abs(userIdx - callIdx);
  if (diff === 0) return 100;
  if (diff === 1) return 60;
  return 30;
}

function callBudgetScore(user: GolferProfile, call: GolfCall): number {
  if (call.estimatedPricePerPerson >= user.budgetMin && call.estimatedPricePerPerson <= user.budgetMax) return 100;
  const gap =
    call.estimatedPricePerPerson < user.budgetMin
      ? user.budgetMin - call.estimatedPricePerPerson
      : call.estimatedPricePerPerson - user.budgetMax;
  return Math.max(20, 90 - gap);
}

function callVibeScore(user: GolferProfile, call: GolfCall): number {
  if (user.vibes[0] === call.vibe) return 100;
  if (user.vibes.includes(call.vibe)) return 75;
  return 40;
}

function callScheduleScore(user: GolferProfile, call: GolfCall): number {
  const slot = callToAvailabilitySlot(call.dateISO, call.timeLabel);
  return user.availability.includes(slot) ? 100 : 45;
}

// No stated course preference is neutral (not a penalty) — a preference
// only ever nudges the score, per "should not completely hide good rounds
// at other courses."
function callCourseScore(user: GolferProfile, call: GolfCall): number {
  if (user.preferredCourses.length === 0) return 70;
  return user.preferredCourses.includes(call.course) ? 100 : 45;
}

const CALL_WEIGHTS = {
  schedule: 0.18,
  distance: 0.18,
  skill: 0.18,
  budget: 0.18,
  vibe: 0.18,
  coursePreference: 0.1,
};

export function computeCallCompatibility(user: GolferProfile, call: GolfCall): CompatibilityBreakdown {
  const schedule = callScheduleScore(user, call);
  const distance = distanceScore(call.distanceMiles);
  const skill = callSkillScore(user, call);
  const budget = callBudgetScore(user, call);
  const vibe = callVibeScore(user, call);
  const coursePreference = callCourseScore(user, call);

  const overall = Math.round(
    schedule * CALL_WEIGHTS.schedule +
      distance * CALL_WEIGHTS.distance +
      skill * CALL_WEIGHTS.skill +
      budget * CALL_WEIGHTS.budget +
      vibe * CALL_WEIGHTS.vibe +
      coursePreference * CALL_WEIGHTS.coursePreference,
  );

  return { overall, schedule, distance, skill, budget, vibe, coursePreference };
}

export function compatibilityLabel(score: number): string {
  if (score >= 85) return "Great Match";
  if (score >= 70) return "Strong Match";
  if (score >= 50) return "Good Match";
  return "Possible Match";
}
