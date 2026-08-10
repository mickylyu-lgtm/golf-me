import type {
  GameFormatPreference,
  GenderPreference,
  GolferProfile,
  GolfVibe,
  GroupTypePreference,
  NetworkingPreference,
  RoundLengthPreference,
  WalkOrCart,
} from "../types";
import { AGE_PREF_MAX, BUDGET_PREF_MAX, HANDICAP_PREF_MAX } from "../types";
import type { NewPreferenceSelections } from "./preferenceMatch";

// Shared value formatters for the Match Preferences sliders — each range's
// top end doubles as its slider's uncapped "+" ceiling.
export function formatDistanceValue(v: number): string {
  return `${v} mi`;
}
export function formatBudgetValue(v: number): string {
  return v >= BUDGET_PREF_MAX ? "$300+" : `$${v}`;
}
export function formatHandicapValue(v: number): string {
  return v >= HANDICAP_PREF_MAX ? "36+" : `${v}`;
}
export function formatAgeValue(v: number): string {
  return v >= AGE_PREF_MAX ? "75+" : `${v}`;
}
export const TRAVEL_RADIUS_PRESETS = [10, 25, 50];

// Everything editable from the unified Match Preferences panel — shown in
// full (all 4 sections) from Find Me a Round, and as the subset that isn't
// already covered by Profile's "Edit profile" identity fields when shown
// there. A plain value object (not GolferProfile) so it can hold a
// temporary, unsaved per-search override just as easily as the user's
// permanent saved preferences.
export interface MatchPreferencesValue extends NewPreferenceSelections {
  preferredCourses: string[];
  travelRadiusMiles: number;
  handicapPreferenceMin: number;
  handicapPreferenceMax: number;
  agePreferenceMin: number;
  agePreferenceMax: number;
  noAgePreference: boolean;
  vibes: GolfVibe[];
  walkOrCart: WalkOrCart;
  budgetMin: number;
  budgetMax: number;
  noBudgetPreference: boolean;
}

export function matchPreferencesFromGolfer(g: GolferProfile): MatchPreferencesValue {
  return {
    preferredCourses: g.preferredCourses,
    travelRadiusMiles: g.travelRadiusMiles,
    handicapPreferenceMin: g.handicapPreferenceMin,
    handicapPreferenceMax: g.handicapPreferenceMax,
    agePreferenceMin: g.agePreferenceMin,
    agePreferenceMax: g.agePreferenceMax,
    noAgePreference: g.noAgePreference,
    genderPreference: g.genderPreference,
    roundLengthPreference: g.roundLengthPreference,
    groupTypePreference: g.groupTypePreference,
    gameFormatPreference: g.gameFormatPreference,
    networkingPreference: g.networkingPreference,
    vibes: g.vibes,
    walkOrCart: g.walkOrCart,
    budgetMin: g.budgetMin,
    budgetMax: g.budgetMax,
    noBudgetPreference: g.noBudgetPreference,
  };
}

// Display labels for just the 5 new Auto-Match preferences that are
// currently selected — this is deliberately NOT courses/radius/skill/vibe/
// budget/walk, which the existing compatibility engine already uses
// silently. Matches the "Using Your Preferences" list in Find Me a Round.
export function selectedNewPreferenceLabels(v: NewPreferenceSelections): string[] {
  const labels: string[] = [];
  if (v.roundLengthPreference !== "No Preference") labels.push(v.roundLengthPreference);
  if (v.genderPreference !== "No preference") labels.push(v.genderPreference === "Prefer mixed group" ? "Mixed Group" : v.genderPreference);
  if (v.groupTypePreference !== "No Preference") labels.push(v.groupTypePreference);
  if (v.gameFormatPreference !== "No Preference") labels.push(v.gameFormatPreference);
  if (v.networkingPreference !== "No Preference") labels.push(v.networkingPreference);
  return labels;
}

export const ROUND_LENGTH_OPTIONS: RoundLengthPreference[] = ["No Preference", "9 Holes", "18 Holes"];
export const GENDER_OPTIONS_MATCH: GenderPreference[] = ["No preference", "Men", "Women", "Prefer mixed group"];
export const GROUP_TYPE_OPTIONS: GroupTypePreference[] = ["No Preference", "New Golfers", "People I Follow", "Golf Circle", "Mixed / Anyone"];
export const GAME_FORMAT_OPTIONS: GameFormatPreference[] = [
  "No Preference",
  "Standard Stroke Play",
  "Match Play",
  "Scramble",
  "Best Ball",
  "Practice / Casual Round",
];
export const NETWORKING_OPTIONS: NetworkingPreference[] = [
  "No Preference",
  "Not Looking to Network",
  "Open to Networking",
  "Business / Professional Networking",
];

const NEW_PREF_PARAM_KEYS = ["roundLength", "gender", "groupType", "gameFormat", "networking"] as const;

// Reads a temporary per-search override out of URL params, falling back to
// the golfer's saved preferences only when NONE of the 5 keys are present at
// all (i.e. Auto-Match wasn't reached through Find Me a Round's preferences
// step). If the search came from that step, every key is always written —
// even "No Preference" ones — so an explicit "clear this for one search"
// choice is distinguishable from "no override given."
export function effectiveNewPreferences(user: GolferProfile, params: URLSearchParams): NewPreferenceSelections {
  const hasOverride = NEW_PREF_PARAM_KEYS.some((k) => params.has(k));
  if (!hasOverride) {
    return {
      roundLengthPreference: user.roundLengthPreference,
      genderPreference: user.genderPreference,
      groupTypePreference: user.groupTypePreference,
      gameFormatPreference: user.gameFormatPreference,
      networkingPreference: user.networkingPreference,
    };
  }
  return {
    roundLengthPreference: (params.get("roundLength") as RoundLengthPreference) || "No Preference",
    genderPreference: (params.get("gender") as GenderPreference) || "No preference",
    groupTypePreference: (params.get("groupType") as GroupTypePreference) || "No Preference",
    gameFormatPreference: (params.get("gameFormat") as GameFormatPreference) || "No Preference",
    networkingPreference: (params.get("networking") as NetworkingPreference) || "No Preference",
  };
}

export function newPreferenceParams(prefs: NewPreferenceSelections): Record<string, string> {
  return {
    roundLength: prefs.roundLengthPreference,
    gender: prefs.genderPreference,
    groupType: prefs.groupTypePreference,
    gameFormat: prefs.gameFormatPreference,
    networking: prefs.networkingPreference,
  };
}
