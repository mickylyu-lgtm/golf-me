import type { GolferProfile } from "../types";
import { avatarColorForName, initialsFromName } from "./avatar";

// Shape of a row from public.profiles (snake_case, as Postgres returns it).
// Kept separate from GolferProfile (camelCase, mock-shaped) rather than
// renaming either side — this is the one seam where they meet.
export interface ProfileRow {
  id: string;
  name: string | null;
  username: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  photo_url: string | null;
  age_range: string | null;
  gender: string | null;
  bio: string;
  area_label: string | null;
  playing_area_lat: number | null;
  playing_area_lng: number | null;
  handicap: number | null;
  skill_level: string | null;
  language: string | null;
  push_enabled: boolean;
  favorite_courses: string[];
  walk_or_cart: string | null;
  vibes: string[];
  budget_min: number;
  budget_max: number;
  no_budget_preference: boolean;
  travel_radius_miles: number;
  availability: string[];
  preferred_courses: string[];
  handicap_preference_min: number;
  handicap_preference_max: number;
  age_preference_min: number;
  age_preference_max: number;
  no_age_preference: boolean;
  gender_preference: string;
  round_length_preference: string;
  group_type_preference: string;
  game_format_preference: string;
  networking_preference: string;
  phone_verified: boolean;
  email_verified: boolean;
  verified_golfer: boolean;
  completed_rounds: number;
  show_up_rate_pct: number;
  would_play_again_pct: number;
  on_time_pct: number;
  respectful_pct: number;
  good_pace_pct: number;
  circle_size: number;
  has_onboarded: boolean;
  onboarding_tutorial_completed: boolean;
  member_since: string;
}

// Used only for the brief window (if ever reached) where a real session
// exists but its profiles row hasn't loaded yet — handle_new_user() stubs
// that row synchronously on signup, so this is a safety net, not the normal
// path. Empty/zeroed everywhere so it reads as "brand new," never fake data.
export function placeholderGolferProfile(id: string, name: string): GolferProfile {
  return {
    id,
    name,
    avatarColor: avatarColorForName(name),
    avatarInitials: initialsFromName(name),
    ageRange: "25-34",
    gender: "Prefer not to say",
    areaLabel: "",
    distanceMiles: 0,
    handicap: null,
    favoriteCourses: [],
    budgetMin: 0,
    budgetMax: 0,
    noBudgetPreference: false,
    availability: [],
    walkOrCart: "Either",
    vibes: [],
    bio: "",
    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: false },
    reputation: { completedRounds: 0, showUpRatePct: 0, wouldPlayAgainPct: 0, onTimePct: 0, respectfulPct: 0, goodPacePct: 0 },
    memberSince: new Date().toISOString(),
    circleSize: 0,
    preferredCourses: [],
    travelRadiusMiles: 25,
    handicapPreferenceMin: 0,
    handicapPreferenceMax: 36,
    agePreferenceMin: 18,
    agePreferenceMax: 75,
    noAgePreference: true,
    genderPreference: "No preference",
    roundLengthPreference: "No Preference",
    groupTypePreference: "No Preference",
    gameFormatPreference: "No Preference",
    networkingPreference: "No Preference",
  };
}

// The inverse direction: every profile-editing surface in the app
// (Profile page edit, Match Preferences, location change, availability,
// AutoMatch's quick-set buttons) already funnels through a single
// `updateCurrentUserProfile(patch: Partial<GolferProfile>)` call — this maps
// that same patch onto real column names so all of those surfaces get real
// persistence for free, no UI changes. Only touches keys actually present in
// the patch (`"x" in patch`, not truthiness) so a patch that only sets one
// field doesn't accidentally null out every other column. Deliberately
// excludes fields the client should never overwrite directly: id,
// distanceMiles (mock-computed, not stored), reputation/circleSize
// (server/aggregate-owned), memberSince.
export function golferPatchToProfileRow(patch: Partial<GolferProfile>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("name" in patch) row.name = patch.name;
  if ("username" in patch) row.username = patch.username || null;
  if ("avatarColor" in patch) row.avatar_color = patch.avatarColor;
  if ("avatarInitials" in patch) row.avatar_initials = patch.avatarInitials;
  if ("photoUrl" in patch) row.photo_url = patch.photoUrl ?? null;
  if ("ageRange" in patch) row.age_range = patch.ageRange;
  if ("gender" in patch) row.gender = patch.gender;
  if ("areaLabel" in patch) row.area_label = patch.areaLabel;
  if ("playingAreaCoords" in patch) {
    row.playing_area_lat = patch.playingAreaCoords?.lat ?? null;
    row.playing_area_lng = patch.playingAreaCoords?.lng ?? null;
  }
  if ("handicap" in patch) row.handicap = patch.handicap;
  if ("favoriteCourses" in patch) row.favorite_courses = patch.favoriteCourses;
  if ("budgetMin" in patch) row.budget_min = patch.budgetMin;
  if ("budgetMax" in patch) row.budget_max = patch.budgetMax;
  if ("noBudgetPreference" in patch) row.no_budget_preference = patch.noBudgetPreference;
  if ("availability" in patch) row.availability = patch.availability;
  if ("walkOrCart" in patch) row.walk_or_cart = patch.walkOrCart;
  if ("vibes" in patch) row.vibes = patch.vibes;
  if ("bio" in patch) row.bio = patch.bio;
  if (patch.verification) {
    if ("phoneVerified" in patch.verification) row.phone_verified = patch.verification.phoneVerified;
    if ("emailVerified" in patch.verification) row.email_verified = patch.verification.emailVerified;
    if ("verifiedGolfer" in patch.verification) row.verified_golfer = patch.verification.verifiedGolfer;
  }
  if ("preferredCourses" in patch) row.preferred_courses = patch.preferredCourses;
  if ("travelRadiusMiles" in patch) row.travel_radius_miles = patch.travelRadiusMiles;
  if ("handicapPreferenceMin" in patch) row.handicap_preference_min = patch.handicapPreferenceMin;
  if ("handicapPreferenceMax" in patch) row.handicap_preference_max = patch.handicapPreferenceMax;
  if ("agePreferenceMin" in patch) row.age_preference_min = patch.agePreferenceMin;
  if ("agePreferenceMax" in patch) row.age_preference_max = patch.agePreferenceMax;
  if ("noAgePreference" in patch) row.no_age_preference = patch.noAgePreference;
  if ("genderPreference" in patch) row.gender_preference = patch.genderPreference;
  if ("roundLengthPreference" in patch) row.round_length_preference = patch.roundLengthPreference;
  if ("groupTypePreference" in patch) row.group_type_preference = patch.groupTypePreference;
  if ("gameFormatPreference" in patch) row.game_format_preference = patch.gameFormatPreference;
  if ("networkingPreference" in patch) row.networking_preference = patch.networkingPreference;
  return row;
}

// Maps a real profiles row onto the existing (mock-shaped) GolferProfile
// type so every existing component keeps working unchanged for a real
// authenticated user. Reputation/verification fields are real zeros here
// (not fabricated numbers) since a fresh real account has none of that yet.
export function profileRowToGolferProfile(row: ProfileRow): GolferProfile {
  const name = row.name?.trim() || "Golfer";
  return {
    id: row.id,
    name,
    username: row.username ?? undefined,
    avatarColor: row.avatar_color || avatarColorForName(name),
    avatarInitials: row.avatar_initials || initialsFromName(name),
    photoUrl: row.photo_url ?? undefined,
    ageRange: (row.age_range as GolferProfile["ageRange"]) || "25-34",
    gender: row.gender || "Prefer not to say",
    areaLabel: row.area_label || "",
    playingAreaCoords:
      row.playing_area_lat != null && row.playing_area_lng != null
        ? { lat: row.playing_area_lat, lng: row.playing_area_lng }
        : undefined,
    distanceMiles: 0,
    handicap: row.handicap,
    favoriteCourses: row.favorite_courses ?? [],
    budgetMin: row.budget_min ?? 0,
    budgetMax: row.budget_max ?? 0,
    noBudgetPreference: row.no_budget_preference ?? false,
    availability: (row.availability as GolferProfile["availability"]) ?? [],
    walkOrCart: (row.walk_or_cart as GolferProfile["walkOrCart"]) || "Either",
    vibes: (row.vibes as GolferProfile["vibes"]) ?? [],
    bio: row.bio ?? "",
    verification: {
      phoneVerified: row.phone_verified ?? false,
      emailVerified: row.email_verified ?? false,
      verifiedGolfer: row.verified_golfer ?? false,
    },
    reputation: {
      completedRounds: row.completed_rounds ?? 0,
      showUpRatePct: row.show_up_rate_pct ?? 0,
      wouldPlayAgainPct: row.would_play_again_pct ?? 0,
      onTimePct: row.on_time_pct ?? 0,
      respectfulPct: row.respectful_pct ?? 0,
      goodPacePct: row.good_pace_pct ?? 0,
    },
    memberSince: row.member_since,
    circleSize: row.circle_size ?? 0,
    preferredCourses: row.preferred_courses ?? [],
    travelRadiusMiles: row.travel_radius_miles ?? 25,
    handicapPreferenceMin: row.handicap_preference_min ?? 0,
    handicapPreferenceMax: row.handicap_preference_max ?? 36,
    agePreferenceMin: row.age_preference_min ?? 18,
    agePreferenceMax: row.age_preference_max ?? 75,
    noAgePreference: row.no_age_preference ?? true,
    genderPreference: (row.gender_preference as GolferProfile["genderPreference"]) || "No preference",
    roundLengthPreference: (row.round_length_preference as GolferProfile["roundLengthPreference"]) || "No Preference",
    groupTypePreference: (row.group_type_preference as GolferProfile["groupTypePreference"]) || "No Preference",
    gameFormatPreference: (row.game_format_preference as GolferProfile["gameFormatPreference"]) || "No Preference",
    networkingPreference: (row.networking_preference as GolferProfile["networkingPreference"]) || "No Preference",
  };
}
