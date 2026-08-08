import type { AgePreference, AgeRange, GenderPreference, GolfCall, GolferProfile } from "../types";
import { computeCallCompatibility } from "./compatibility";
import type { CompatibilityBreakdown } from "./compatibility";

export interface AutoMatchCandidate {
  call: GolfCall;
  breakdown: CompatibilityBreakdown;
  roster: GolferProfile[];
  // Includes the invisible background factors (credibility/age/gender) —
  // used only to sort candidates, never shown or explained in the UI. The
  // visible "why this matches" always comes from `breakdown` via
  // callMatchReasons, which never includes these.
  rankScore: number;
}

function ageMatchesPreference(ageRange: AgeRange, pref: AgePreference): boolean {
  if (pref === "Any age") return true;
  if (pref === "55+") return ageRange === "55-64" || ageRange === "65+";
  return ageRange === pref;
}

function genderMatchesPreference(roster: GolferProfile[], pref: GenderPreference): boolean {
  if (pref === "No preference" || roster.length === 0) return true;
  if (pref === "Men") return roster.every((g) => g.gender === "Man");
  if (pref === "Women") return roster.every((g) => g.gender === "Woman");
  if (pref === "Prefer mixed group") return new Set(roster.map((g) => g.gender)).size > 1;
  return true;
}

// Small, capped nudges — never enough to override the visible compatibility
// score, and a round with new/low-history golfers is never penalized, only
// not given the (optional) credibility bonus.
function backgroundBonus(user: GolferProfile, roster: GolferProfile[]): number {
  let bonus = 0;

  const established = roster.filter((g) => g.reputation.completedRounds >= 5);
  if (established.length > 0) {
    const avgWouldPlayAgain = established.reduce((sum, g) => sum + g.reputation.wouldPlayAgainPct, 0) / established.length;
    bonus += (avgWouldPlayAgain / 100) * 6; // up to +6
  }

  if (user.agePreference !== "Any age" && roster.length > 0) {
    bonus += roster.some((g) => ageMatchesPreference(g.ageRange, user.agePreference)) ? 3 : -2;
  }

  if (user.genderPreference !== "No preference") {
    bonus += genderMatchesPreference(roster, user.genderPreference) ? 3 : -2;
  }

  return bonus;
}

export function rankCallsForAutoMatch(
  user: GolferProfile,
  calls: GolfCall[],
  getGolfer: (id: string) => GolferProfile | undefined,
): AutoMatchCandidate[] {
  return calls
    .map((call) => {
      const breakdown = computeCallCompatibility(user, call);
      const roster = call.joinedGolferIds.map(getGolfer).filter((g): g is GolferProfile => Boolean(g));
      const rankScore = breakdown.overall + backgroundBonus(user, roster);
      return { call, breakdown, roster, rankScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}
