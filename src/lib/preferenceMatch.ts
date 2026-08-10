import type {
  GameFormatPreference,
  GenderPreference,
  GolfCall,
  GolferProfile,
  GroupTypePreference,
  NetworkingPreference,
  RoundLengthPreference,
} from "../types";

// The narrow shape evaluatePreferenceMatch/selectedPreferenceCount actually
// need — satisfied by a full GolferProfile, but also by a plain draft value
// (Find Me a Round's temporary per-search override, which isn't a full
// profile until/unless explicitly saved).
export interface NewPreferenceSelections {
  roundLengthPreference: RoundLengthPreference;
  genderPreference: GenderPreference;
  groupTypePreference: GroupTypePreference;
  gameFormatPreference: GameFormatPreference;
  networkingPreference: NetworkingPreference;
}

// The 5 Match Preferences layer sits ON TOP OF the existing 5-signal
// compatibility score (schedule/distance/skill/budget/vibe in compatibility.ts)
// — it never replaces it. Basic eligibility (date/time, radius, open spot)
// and the existing score both still apply; this only adds a "how many of
// your explicitly-selected preferences does this round actually satisfy"
// gate + explanation on top.

export type PreferenceKey = "roundLength" | "gender" | "groupType" | "gameFormat" | "networking";

export interface PreferenceCheck {
  key: PreferenceKey;
  label: string; // the golfer's selected value, e.g. "18 Holes"
  matched: boolean;
}

// Precomputed relationship sets for the current user, passed in rather than
// looked up here — keeps this module a pure function like the rest of lib/.
export interface PreferenceMatchContext {
  followingIds: Set<string>;
  circleIds: Set<string>;
  playedWithIds: Set<string>;
}

function groupTypeMatches(pref: GroupTypePreference, otherIds: string[], ctx: PreferenceMatchContext): boolean {
  switch (pref) {
    case "New Golfers":
      return otherIds.length > 0 && otherIds.every((id) => !ctx.playedWithIds.has(id));
    case "People I Follow":
      return otherIds.some((id) => ctx.followingIds.has(id));
    case "Golf Circle":
      return otherIds.some((id) => ctx.circleIds.has(id));
    case "Mixed / Anyone":
      return true; // explicit "no relationship restriction" — always satisfied
    default:
      return true;
  }
}

function genderGroupMatches(pref: GenderPreference, roster: GolferProfile[]): boolean {
  if (roster.length === 0) return false;
  if (pref === "Men") return roster.every((g) => g.gender === "Man");
  if (pref === "Women") return roster.every((g) => g.gender === "Woman");
  if (pref === "Prefer mixed group") return new Set(roster.map((g) => g.gender)).size > 1;
  return true;
}

// Reuses the round's existing Golf Vibe rather than adding a parallel
// "networking openness" field to Golf Calls — a round already tagged
// "Networking" vibe is the round that's actually about networking.
function networkingMatches(pref: NetworkingPreference, call: GolfCall): boolean {
  if (pref === "Not Looking to Network") return call.vibe !== "Networking";
  return call.vibe === "Networking"; // Open to Networking / Business & Professional
}

// roster = everyone currently in the round. currentUserId is only used to
// exclude the user from "other golfers in the group" checks (New Golfers /
// People I Follow / Golf Circle) — it's separate from `prefs` so a
// temporarily-overridden search can be evaluated without touching the
// user's saved profile.
export function evaluatePreferenceMatch(
  prefs: NewPreferenceSelections,
  currentUserId: string,
  call: GolfCall,
  roster: GolferProfile[],
  ctx: PreferenceMatchContext,
): PreferenceCheck[] {
  const checks: PreferenceCheck[] = [];
  const otherIds = roster.filter((g) => g.id !== currentUserId).map((g) => g.id);

  if (prefs.roundLengthPreference !== "No Preference") {
    checks.push({
      key: "roundLength",
      label: prefs.roundLengthPreference,
      matched: call.holes === (prefs.roundLengthPreference === "9 Holes" ? 9 : 18),
    });
  }
  if (prefs.genderPreference !== "No preference") {
    checks.push({ key: "gender", label: prefs.genderPreference, matched: genderGroupMatches(prefs.genderPreference, roster) });
  }
  if (prefs.groupTypePreference !== "No Preference") {
    checks.push({
      key: "groupType",
      label: prefs.groupTypePreference,
      matched: groupTypeMatches(prefs.groupTypePreference, otherIds, ctx),
    });
  }
  if (prefs.gameFormatPreference !== "No Preference") {
    checks.push({ key: "gameFormat", label: prefs.gameFormatPreference, matched: call.gameFormat === prefs.gameFormatPreference });
  }
  if (prefs.networkingPreference !== "No Preference") {
    checks.push({ key: "networking", label: prefs.networkingPreference, matched: networkingMatches(prefs.networkingPreference, call) });
  }

  return checks;
}

export function selectedPreferenceCount(prefs: NewPreferenceSelections): number {
  let count = 0;
  if (prefs.roundLengthPreference !== "No Preference") count++;
  if (prefs.genderPreference !== "No preference") count++;
  if (prefs.groupTypePreference !== "No Preference") count++;
  if (prefs.gameFormatPreference !== "No Preference") count++;
  if (prefs.networkingPreference !== "No Preference") count++;
  return count;
}

export type PreferenceTier = "excellent" | "great" | "good" | "none";

const TIER_LABEL: Record<PreferenceTier, string> = {
  excellent: "Excellent Match",
  great: "Great Match",
  good: "Good Match",
  none: "",
};

export function preferenceTier(matchedCount: number): PreferenceTier {
  if (matchedCount >= 5) return "excellent";
  if (matchedCount === 4) return "great";
  if (matchedCount === 3) return "good";
  return "none";
}

export function preferenceTierLabel(tier: PreferenceTier): string {
  return TIER_LABEL[tier];
}

export const MIN_PREFERENCES_FOR_AUTO_MATCH = 3;

// Friendly category name for a NOT-matched preference — matched items show
// the golfer's selected value instead (e.g. "18 Holes"), so this is only
// ever needed for the "not matched" side of the explanation.
export const PREFERENCE_KEY_LABEL: Record<PreferenceKey, string> = {
  roundLength: "Round Length",
  gender: "Gender Preference",
  groupType: "Group Type",
  gameFormat: "Game Format",
  networking: "Networking",
};
