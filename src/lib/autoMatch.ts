import type { AgeRange, GenderPreference, GolfCall, GolferProfile } from "../types";
import { HANDICAP_PREF_MAX, HANDICAP_PREF_MIN } from "../types";
import { computeCallCompatibility } from "./compatibility";
import type { CompatibilityBreakdown } from "./compatibility";
import { evaluatePreferenceMatch, preferenceTier } from "./preferenceMatch";
import type { NewPreferenceSelections, PreferenceCheck, PreferenceMatchContext, PreferenceTier } from "./preferenceMatch";

// Bucketed own-age ranges map to a numeric span so they can be checked
// against a preference's numeric min/max — "65+" and the preference slider's
// own "75+" uncapped top both resolve to a generously high ceiling.
const AGE_RANGE_BOUNDS: Record<AgeRange, [number, number]> = {
  "18-24": [18, 24],
  "25-34": [25, 34],
  "35-44": [35, 44],
  "45-54": [45, 54],
  "55-64": [55, 64],
  "65+": [65, 120],
};

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

function ageMatchesPreference(ageRange: AgeRange, prefMin: number, prefMax: number): boolean {
  const [lo, hi] = AGE_RANGE_BOUNDS[ageRange];
  return hi >= prefMin && lo <= prefMax;
}

function handicapMatchesPreference(handicap: number | null, prefMin: number, prefMax: number): boolean {
  // No handicap on file is treated as a wide beginner band (same convention
  // as compatibility.ts's skillScore), so it isn't unfairly excluded.
  const h = handicap ?? 30;
  return h >= prefMin && h <= prefMax;
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

  if (!user.noAgePreference && roster.length > 0) {
    bonus += roster.some((g) => ageMatchesPreference(g.ageRange, user.agePreferenceMin, user.agePreferenceMax)) ? 3 : -2;
  }

  // A full-span handicap range is the slider's "no preference" state —
  // same convention as travelRadiusMiles/budget, no separate boolean needed.
  const hasHandicapPreference = user.handicapPreferenceMin > HANDICAP_PREF_MIN || user.handicapPreferenceMax < HANDICAP_PREF_MAX;
  if (hasHandicapPreference && roster.length > 0) {
    bonus += roster.some((g) => handicapMatchesPreference(g.handicap, user.handicapPreferenceMin, user.handicapPreferenceMax)) ? 3 : -2;
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

// STEP 2-4 of Auto-Match: layers the "3+ shared Match Preferences" gate on
// top of the existing compatibility ranking above (STEP 1 basic eligibility
// — date/time, radius, open spot — is still the caller's job, same as
// today). `prefs` is passed separately from `user` so a temporary per-search
// override never has to be written into the user's saved profile.
export interface PreferenceRankedCandidate extends AutoMatchCandidate {
  preferenceChecks: PreferenceCheck[];
  preferenceMatchedCount: number;
  preferenceTier: PreferenceTier;
}

export function rankCallsWithPreferences(
  user: GolferProfile,
  prefs: NewPreferenceSelections,
  calls: GolfCall[],
  getGolfer: (id: string) => GolferProfile | undefined,
  ctx: PreferenceMatchContext,
): PreferenceRankedCandidate[] {
  return rankCallsForAutoMatch(user, calls, getGolfer).map((candidate) => {
    const preferenceChecks = evaluatePreferenceMatch(prefs, user.id, candidate.call, candidate.roster, ctx);
    const preferenceMatchedCount = preferenceChecks.filter((c) => c.matched).length;
    return { ...candidate, preferenceChecks, preferenceMatchedCount, preferenceTier: preferenceTier(preferenceMatchedCount) };
  });
}
