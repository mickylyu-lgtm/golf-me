// Other golfers' profiles, read through the server's narrow RPCs (migration
// 20261106120000_add_public_golfer_directory) instead of the whole profiles
// table. Pure helpers only (no React, no Supabase import) so
// tests/publicDirectory.test.ts can run them under node --test; the network
// side is lib/publicProfilesFetch.ts.
//
//   golfer_directory(p_limit, p_offset)   the Golfers list: onboarded, named,
//       Discoverable, unblocked either way, not a test/reviewer account,
//       never the caller. Nearest first.
//   golfer_public_profiles(p_ids)         people this account already knows
//       (rounds, chats, follows, notifications, posts); blocked -> no row.
//
// Neither returns coordinates: distance comes back as a coarse bucket
// computed between ~5 km cells (see the migration header).
import type { GolferProfile } from "../types";
import type { TranslationKey } from "../i18n/locales/en";
import { avatarColorForName, initialsFromName } from "./avatar.ts";
import { roundedMiles } from "./geo.ts";

// Same neutral defaults as lib/profile placeholderGolferProfile (not
// imported: profile.ts isn't loadable under node --test).
function neutralProfile(id: string, name: string): GolferProfile {
  return {
    id,
    name,
    avatarColor: avatarColorForName(name),
    avatarInitials: initialsFromName(name),
    gender: "Prefer not to say",
    areaLabel: "",
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
    memberSince: new Date(0).toISOString(),
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

export const DIRECTORY_RPC = "golfer_directory";
export const PUBLIC_PROFILES_RPC = "golfer_public_profiles";
/** Directory with buckets measured from a search area (migration 20261106130100). */
export const DIRECTORY_FROM_RPC = "golfer_directory_from";
/** Names/avatars for the caller's own blocks (migration 20261106130000). */
export const MY_BLOCKED_PROFILES_RPC = "my_blocked_profiles";

/** Directory cell size in degrees (same as the server's 0.05). */
export const DIRECTORY_CELL_DEGREES = 0.05;

/**
 * A search area snapped to the centre of its ~5 km directory cell, the same
 * snapping the server applies. Sent instead of the picked point, so a
 * temporary area never leaves the device more precisely than the server
 * would use it anyway. null for missing/invalid coordinates.
 */
export function snapToDirectoryCell(point: { lat: number; lng: number } | null | undefined): { lat: number; lng: number } | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return null;
  const snap = (v: number) => Math.round((Math.floor(v / DIRECTORY_CELL_DEGREES) * DIRECTORY_CELL_DEGREES + DIRECTORY_CELL_DEGREES / 2) * 1e6) / 1e6;
  return { lat: snap(point.lat), lng: snap(point.lng) };
}
/** Server cap per golfer_directory page. */
export const DIRECTORY_PAGE_SIZE = 100;
/** The client stops paging after this many golfers (Discover ranks client-side). */
export const DIRECTORY_MAX = 500;
/** Server cap on ids per golfer_public_profiles call. */
export const PUBLIC_PROFILES_CHUNK = 200;

export const DISTANCE_BUCKETS = ["within_5", "5_to_10", "10_to_15", "15_to_25", "25_to_50", "over_50"] as const;
export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number];

/**
 * Range of each bucket in miles (max null = open-ended), for labels such as
 * "Within 5 mi" / "5-10 mi" / "50+ mi". The edges match
 * lib/compatibility distanceScore.
 */
export const DISTANCE_BUCKET_RANGE: Record<DistanceBucket, { min: number; max: number | null }> = {
  within_5: { min: 0, max: 5 },
  "5_to_10": { min: 5, max: 10 },
  "10_to_15": { min: 10, max: 15 },
  "15_to_25": { min: 15, max: 25 },
  "25_to_50": { min: 25, max: 50 },
  over_50: { min: 50, max: null },
};

export function isDistanceBucket(value: unknown): value is DistanceBucket {
  return typeof value === "string" && (DISTANCE_BUCKETS as readonly string[]).includes(value);
}

/**
 * The number GolferProfile.distanceMiles carries for a bucketed golfer: the
 * bucket's upper edge (100 for "over 50"). It only feeds compatibility
 * scoring and distance sorting, which then rank by bucket. It is NOT a
 * measured distance: labels should come from distanceBucket.
 */
export function bucketRepresentativeMiles(bucket: DistanceBucket): number {
  return DISTANCE_BUCKET_RANGE[bucket].max ?? 100;
}

/** Translated label per bucket ("Within 5 mi", "5–10 mi", ..., "50+ mi"). */
export const DISTANCE_BUCKET_LABEL_KEYS: Record<DistanceBucket, TranslationKey> = {
  within_5: "distance.bucket.within_5",
  "5_to_10": "distance.bucket.5_to_10",
  "10_to_15": "distance.bucket.10_to_15",
  "15_to_25": "distance.bucket.15_to_25",
  "25_to_50": "distance.bucket.25_to_50",
  over_50: "distance.bucket.over_50",
};

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * The one way to label ANOTHER golfer's distance (cards, profile page, match
 * reasons). A server bucket always wins and is shown as a range: its
 * distanceMiles is only the bucket's upper edge, never printed. Without a
 * bucket, a real distance (demo fixtures, or coordinates on a database
 * without the directory RPCs) reads in whole miles ("7 mi away", "<1 mi
 * away"). Unknown -> undefined (show nothing, never guess).
 */
export function golferDistanceLabel(
  golfer: Pick<GolferProfile, "distanceBucket">,
  realMiles: number | undefined,
  t: TFn,
): string | undefined {
  if (golfer.distanceBucket && isDistanceBucket(golfer.distanceBucket)) return t(DISTANCE_BUCKET_LABEL_KEYS[golfer.distanceBucket]);
  if (realMiles === undefined || !Number.isFinite(realMiles)) return undefined;
  return t("golfCallCard.miAway", { miles: roundedMiles(realMiles) });
}

/** Row shape of both RPCs (gender only from golfer_public_profiles). */
export interface PublicProfileRow {
  id: string;
  name: string | null;
  username: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  photo_url: string | null;
  age_range: string | null;
  gender?: string | null;
  bio: string | null;
  area_label: string | null;
  handicap: number | null;
  skill_level: string | null;
  favorite_courses: string[] | null;
  walk_or_cart: string | null;
  vibes: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  no_budget_preference: boolean | null;
  availability: string[] | null;
  verified_golfer: boolean | null;
  completed_rounds: number | null;
  show_up_rate_pct: number | null;
  would_play_again_pct: number | null;
  on_time_pct: number | null;
  respectful_pct: number | null;
  good_pace_pct: number | null;
  circle_size: number | null;
  member_since: string;
  founding_member_number: number | null;
  distance_bucket: string | null;
}

/**
 * Maps an RPC row onto GolferProfile. Fields the server deliberately doesn't
 * return (coordinates, match preferences, private settings) get the same
 * neutral defaults a brand-new profile has; nothing is fabricated.
 * playingAreaCoords stays undefined: distance comes from the bucket.
 */
export function publicProfileRowToGolferProfile(row: PublicProfileRow): GolferProfile {
  const name = row.name?.trim() || "Golfer";
  const base = neutralProfile(row.id, name);
  const bucket = isDistanceBucket(row.distance_bucket) ? row.distance_bucket : undefined;
  return {
    ...base,
    username: row.username ?? undefined,
    avatarColor: row.avatar_color || base.avatarColor,
    avatarInitials: row.avatar_initials || base.avatarInitials,
    photoUrl: row.photo_url ?? undefined,
    ageRange: (row.age_range as GolferProfile["ageRange"]) || undefined,
    gender: row.gender || base.gender,
    areaLabel: row.area_label || "",
    playingAreaCoords: undefined,
    distanceMiles: bucket ? bucketRepresentativeMiles(bucket) : undefined,
    distanceBucket: bucket,
    handicap: row.handicap,
    favoriteCourses: row.favorite_courses ?? [],
    budgetMin: row.budget_min ?? 0,
    budgetMax: row.budget_max ?? 0,
    noBudgetPreference: row.no_budget_preference ?? false,
    availability: (row.availability as GolferProfile["availability"]) ?? [],
    walkOrCart: (row.walk_or_cart as GolferProfile["walkOrCart"]) || "Either",
    vibes: (row.vibes as GolferProfile["vibes"]) ?? [],
    bio: row.bio ?? "",
    verification: { phoneVerified: false, emailVerified: false, verifiedGolfer: row.verified_golfer ?? false },
    reputation: {
      completedRounds: row.completed_rounds ?? 0,
      showUpRatePct: row.show_up_rate_pct ?? 0,
      wouldPlayAgainPct: row.would_play_again_pct ?? 0,
      onTimePct: row.on_time_pct ?? 0,
      respectfulPct: row.respectful_pct ?? 0,
      goodPacePct: row.good_pace_pct ?? 0,
    },
    memberSince: row.member_since,
    foundingMemberNumber: row.founding_member_number ?? undefined,
    circleSize: row.circle_size ?? 0,
  };
}

/** Row shape of my_blocked_profiles(): name and avatar only. */
export interface BlockedProfileRow {
  id: string;
  name: string | null;
  avatar_color: string | null;
  avatar_initials: string | null;
  photo_url: string | null;
}

/** A blocked contact's name/avatar as a GolferProfile (everything else neutral). */
export function blockedProfileRowToGolferProfile(row: BlockedProfileRow): GolferProfile {
  const name = row.name?.trim() || "Golfer";
  const base = neutralProfile(row.id, name);
  return {
    ...base,
    avatarColor: row.avatar_color || base.avatarColor,
    avatarInitials: row.avatar_initials || base.avatarInitials,
    photoUrl: row.photo_url ?? undefined,
  };
}

/**
 * PostgREST answers PGRST202 when a function is not in its schema cache;
 * Postgres answers 42883 for an undefined function. Only that means "this
 * database doesn't have the RPC yet" and allows the old table read; any
 * other error (network, permission) must surface, never silently widen.
 */
export function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined, fn: string): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return typeof error.message === "string" && error.message.includes(fn) && /could not find|does not exist/i.test(error.message);
}

/**
 * Remembers, per RPC, that the database lacked it, so a pre-migration
 * database costs one failed call per window instead of one per refetch. The
 * RPC is tried again after the window, so applying the migration takes
 * effect without a reload.
 */
export const MISSING_RPC_RETRY_MS = 10 * 60 * 1000;

export class RpcAvailability {
  private missingAt = new Map<string, number>();
  shouldTry(fn: string, now: number): boolean {
    const at = this.missingAt.get(fn);
    return at === undefined || now - at >= MISSING_RPC_RETRY_MS;
  }
  markMissing(fn: string, now: number): void {
    this.missingAt.set(fn, now);
  }
  markPresent(fn: string): void {
    this.missingAt.delete(fn);
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Old-schema fallback for the Golfers list (full profiles rows from the
 * table read): the same completeness and Discoverable rules the server
 * applies, minus what only the server can know (test/reviewer roles,
 * blocks are filtered later by the caller).
 */
export function isListableFallbackRow(
  row: { id: string; name: string | null; has_onboarded?: boolean; discoverable?: boolean | null },
  selfId: string | undefined,
): boolean {
  return row.id !== selfId && row.has_onboarded !== false && Boolean(row.name?.trim()) && row.discoverable !== false;
}
