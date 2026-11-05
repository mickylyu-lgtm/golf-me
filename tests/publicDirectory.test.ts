// Run: npm run test:trust  (node --test, built-in type stripping)
// Client side of the server golfer directory (src/lib/publicDirectory.ts,
// migrations 20261106120000 / 20261106120100). The database rules themselves
// are checked by scripts/staging/public-directory-authz.sql. Synthetic ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import {
  DISTANCE_BUCKET_LABEL_KEYS,
  golferDistanceLabel,
  DISTANCE_BUCKETS,
  DISTANCE_BUCKET_RANGE,
  MISSING_RPC_RETRY_MS,
  RpcAvailability,
  bucketRepresentativeMiles,
  chunk,
  isListableFallbackRow,
  isMissingFunctionError,
  publicProfileRowToGolferProfile,
} from "../src/lib/publicDirectory.ts";
import type { PublicProfileRow } from "../src/lib/publicDirectory.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--") && !l.trimStart().startsWith("//"))
    .join("\n");

function row(overrides: Partial<PublicProfileRow> = {}): PublicProfileRow {
  return {
    id: "g1",
    name: "Pat",
    username: "pat",
    avatar_color: null,
    avatar_initials: null,
    photo_url: null,
    age_range: "25-34",
    bio: "hi",
    area_label: "Brooklyn, NY",
    handicap: 12,
    skill_level: "Intermediate",
    favorite_courses: ["Dyker Beach"],
    walk_or_cart: "Walking",
    vibes: ["Casual & Social"],
    budget_min: 20,
    budget_max: 80,
    no_budget_preference: false,
    availability: ["Weekend Mornings"],
    verified_golfer: false,
    completed_rounds: 3,
    show_up_rate_pct: 100,
    would_play_again_pct: 90,
    on_time_pct: 100,
    respectful_pct: 100,
    good_pace_pct: 100,
    circle_size: 2,
    member_since: "2026-10-01T00:00:00Z",
    founding_member_number: 7,
    distance_bucket: "within_5",
    ...overrides,
  };
}

test("an RPC row maps to the same GolferProfile shape, without coordinates", () => {
  const g = publicProfileRowToGolferProfile(row());
  assert.equal(g.id, "g1");
  assert.equal(g.name, "Pat");
  assert.equal(g.playingAreaCoords, undefined);
  assert.equal(g.distanceBucket, "within_5");
  assert.equal(g.distanceMiles, 5);
  assert.equal(g.foundingMemberNumber, 7);
  assert.equal(g.reputation.wouldPlayAgainPct, 90);
  assert.deepEqual(g.favoriteCourses, ["Dyker Beach"]);
  assert.equal(g.ageRange, "25-34");
  // Private fields the server never sends get neutral defaults, never guesses.
  assert.equal(g.gender, "Prefer not to say");
  assert.equal(g.travelRadiusMiles, 25);
  assert.equal(g.genderPreference, "No preference");
  assert.equal(g.verification.emailVerified, false);
});

test("missing or unknown buckets mean unknown distance; gender passes through when sent", () => {
  assert.equal(publicProfileRowToGolferProfile(row({ distance_bucket: null })).distanceMiles, undefined);
  assert.equal(publicProfileRowToGolferProfile(row({ distance_bucket: "12.3" })).distanceBucket, undefined);
  assert.equal(publicProfileRowToGolferProfile(row({ gender: "Woman" })).gender, "Woman");
  assert.equal(publicProfileRowToGolferProfile(row({ name: "  " })).name, "Golfer");
  assert.equal(publicProfileRowToGolferProfile(row({ founding_member_number: null })).foundingMemberNumber, undefined);
});

test("bucket edges match the compatibility distance tiers and the SQL", () => {
  assert.deepEqual(
    DISTANCE_BUCKETS.map(bucketRepresentativeMiles),
    [5, 10, 15, 25, 50, 100],
  );
  for (const b of DISTANCE_BUCKETS) {
    const { min, max } = DISTANCE_BUCKET_RANGE[b];
    assert.ok(max === null || max > min, b);
  }
  const sql = stripComments(read("../supabase/migrations/20261106120000_add_public_golfer_directory.sql"));
  for (const b of DISTANCE_BUCKETS) assert.ok(sql.includes(`'${b}'`), `SQL emits ${b}`);
});

test("only a missing-function error allows the old table read", () => {
  assert.equal(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function" }, "golfer_directory"), true);
  assert.equal(isMissingFunctionError({ code: "42883", message: "function does not exist" }, "golfer_directory"), true);
  assert.equal(isMissingFunctionError({ message: "Could not find the function public.golfer_directory(p_limit, p_offset)" }, "golfer_directory"), true);
  assert.equal(isMissingFunctionError({ code: "42501", message: "permission denied" }, "golfer_directory"), false);
  assert.equal(isMissingFunctionError({ message: "Failed to fetch" }, "golfer_directory"), false);
  assert.equal(isMissingFunctionError(null, "golfer_directory"), false);
});

test("a missing RPC is retried after the window, so applying the migration needs no reload", () => {
  const a = new RpcAvailability();
  assert.equal(a.shouldTry("f", 0), true);
  a.markMissing("f", 1000);
  assert.equal(a.shouldTry("f", 1000 + MISSING_RPC_RETRY_MS - 1), false);
  assert.equal(a.shouldTry("f", 1000 + MISSING_RPC_RETRY_MS), true);
  a.markPresent("f");
  assert.equal(a.shouldTry("f", 1001), true);
});

test("ids are chunked to the server cap", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 200), []);
});

test("old-schema fallback applies the same completeness and Discoverable rules", () => {
  assert.equal(isListableFallbackRow({ id: "a", name: "A", has_onboarded: true }, "me"), true);
  assert.equal(isListableFallbackRow({ id: "me", name: "Me", has_onboarded: true }, "me"), false);
  assert.equal(isListableFallbackRow({ id: "a", name: "A", has_onboarded: false }, "me"), false);
  assert.equal(isListableFallbackRow({ id: "a", name: "  ", has_onboarded: true }, "me"), false);
  assert.equal(isListableFallbackRow({ id: "a", name: "A", has_onboarded: true, discoverable: false }, "me"), false);
});

test("the client reads other golfers only through lib/publicProfilesFetch", () => {
  const files = [
    ...readdirSync(new URL("../src/context/", import.meta.url)).map((f) => `../src/context/${f}`),
    ...readdirSync(new URL("../src/lib/", import.meta.url)).map((f) => `../src/lib/${f}`),
    ...readdirSync(new URL("../src/pages/", import.meta.url)).map((f) => `../src/pages/${f}`),
  ].filter((f) => /\.tsx?$/.test(f));
  const offenders: string[] = [];
  for (const f of files) {
    if (f.endsWith("publicProfilesFetch.ts")) continue;
    const src = stripComments(read(f));
    // Any profiles read that isn't the caller's own row (.eq("id", ...)).
    const re = /from\("profiles"\)\s*\.select\([^)]*\)(?!\s*\.eq\("id")/g;
    if (re.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

test("both RPCs are definer, pinned search_path, no anon, no coordinates in the result", () => {
  const sql = stripComments(read("../supabase/migrations/20261106120000_add_public_golfer_directory.sql"));
  for (const fn of ["golfer_directory", "golfer_public_profiles"]) {
    const start = sql.indexOf(`create function public.${fn}(`);
    assert.ok(start >= 0, fn);
    const header = sql.slice(start, sql.indexOf("as $$", start));
    const columns = header.slice(0, header.indexOf("\nlanguage "));
    assert.match(header, /security definer/);
    assert.match(header, /set search_path = ''/);
    assert.doesNotMatch(columns, /playing_area|travel_radius|push_enabled|notify_|discoverable|language|_preference_|gender_preference/);
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon;`));
  }
  const phase2 = stripComments(read("../supabase/migrations/20261106120100_restrict_profiles_select_to_own_row.sql"));
  assert.match(phase2, /drop policy "profiles_select_authenticated"/);
  assert.match(phase2, /using \(\(select auth\.uid\(\)\) = id\)/);
  assert.match(phase2, /Apply 20261106120000_add_public_golfer_directory first/);
});

// A t() stand-in over the English dictionary, with {var} interpolation.
const tEn = (key: string, vars?: Record<string, string | number>) =>
  (en as Record<string, string>)[key].replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? ""));

test("another golfer's distance: a bucket reads as a range, never as its upper edge", () => {
  for (const bucket of DISTANCE_BUCKETS) {
    const g = publicProfileRowToGolferProfile(row({ distance_bucket: bucket }));
    const label = golferDistanceLabel(g, g.distanceMiles, tEn);
    assert.equal(label, tEn(DISTANCE_BUCKET_LABEL_KEYS[bucket]));
    // The representative number (5, 10, ... 100) must not be printed as "N mi away".
    assert.notEqual(label, tEn("golfCallCard.miAway", { miles: String(g.distanceMiles) }));
  }
  assert.equal(golferDistanceLabel({ distanceBucket: "within_5" }, 5, tEn), "Within 5 mi");
  assert.equal(golferDistanceLabel({ distanceBucket: "over_50" }, 100, tEn), "50+ mi");
});

test("without a bucket: whole miles for a real distance, nothing when unknown", () => {
  assert.equal(golferDistanceLabel({}, 6.7, tEn), "7 mi away");
  assert.equal(golferDistanceLabel({}, 0.3, tEn), "<1 mi away");
  assert.equal(golferDistanceLabel({}, undefined, tEn), undefined);
  assert.equal(golferDistanceLabel({}, Number.NaN, tEn), undefined);
});

test("every language has every bucket label, none of them a bare number", () => {
  const locales = { en, es, ja, ko, zhCN, zhTW } as Record<string, Record<string, string>>;
  for (const [name, dict] of Object.entries(locales)) {
    for (const key of Object.values(DISTANCE_BUCKET_LABEL_KEYS)) {
      assert.ok(dict[key]?.trim(), `${name} is missing ${key}`);
      assert.doesNotMatch(dict[key], /^\d+(\.\d+)?\s*(mi|マイル|마일|英里)?$/, `${name} ${key} reads as an exact distance`);
    }
  }
});

test("golfer cards, the profile page and compare label other golfers through golferDistanceLabel", () => {
  for (const f of ["../src/components/golfer/GolferCard.tsx", "../src/pages/GolferProfilePage.tsx", "../src/components/golfer/CompareModal.tsx"]) {
    const src = stripComments(read(f));
    assert.match(src, /golferDistanceLabel\(/, f);
    assert.doesNotMatch(src, /roundedMiles\(|toFixed\(/, `${f} formats a golfer distance itself`);
  }
  const reasons = stripComments(read("../src/lib/matchReasons.ts"));
  assert.doesNotMatch(reasons, /golferNearby|golferFar/, "golfer reasons use the label, unknown distance is dropped");
});
