// Run: npm run test:play  (node --test, built-in type stripping)
// Auto-Match golfer suggestions for a "Playing Somewhere Else?" area
// (src/lib/travelGolfers.ts, migration 20261106130100). The server side
// (origin buckets, snapping, no coordinates) is checked by
// scripts/staging/directory-followups-authz.sql. Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { golferDistanceSource, golfersForSource } from "../src/lib/travelGolfers.ts";
import type { TravelDirectoryStatus } from "../src/lib/travelGolfers.ts";
import { nearbyGolfers } from "../src/lib/autoMatchLadder.ts";
import { bucketRepresentativeMiles, publicProfileRowToGolferProfile, snapToDirectoryCell } from "../src/lib/publicDirectory.ts";
import type { DistanceBucket, PublicProfileRow } from "../src/lib/publicDirectory.ts";
import { effectiveLocation, isTemporaryLocation, locationParams } from "../src/lib/travelLocation.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

function row(id: string, bucket: DistanceBucket | null): PublicProfileRow {
  return {
    id, name: id, username: null, avatar_color: null, avatar_initials: null, photo_url: null, age_range: null,
    bio: "", area_label: id, handicap: 12, skill_level: null, favorite_courses: [], walk_or_cart: null, vibes: [],
    budget_min: 0, budget_max: 0, no_budget_preference: true, availability: [], verified_golfer: false,
    completed_rounds: 0, show_up_rate_pct: 0, would_play_again_pct: 0, on_time_pct: 0, respectful_pct: 0,
    good_pace_pct: 0, circle_size: 0, member_since: "2026-10-01T00:00:00Z", founding_member_number: null,
    distance_bucket: bucket,
  };
}
// The ranking Auto-Match does: distance = the golfer's (bucket) distance, equal scores.
const candidates = (rows: PublicProfileRow[]) =>
  rows.map(publicProfileRowToGolferProfile).map((g) => ({ id: g.id, golfer: g, distanceMiles: g.distanceMiles, score: 80 }));
const noBlocks = () => false;

// Same two golfers, as the server describes them from each origin.
const FROM_NYC_HOME = candidates([row("nyc", "within_5"), row("la", "over_50")]);
const FROM_LA_SEARCH = candidates([row("nyc", "over_50"), row("la", "within_5")]);

test("NYC home, LA search, 10 mi: the LA golfer is suggested and the NYC golfer is not", () => {
  const source = golferDistanceSource({ temporaryArea: true, isDemo: false, areaHasCoords: true, travelStatus: "ready" });
  assert.equal(source, "travel");
  const near = nearbyGolfers(golfersForSource(source, FROM_NYC_HOME, FROM_LA_SEARCH), 10, 10, noBlocks);
  assert.deepEqual(near.golfers.map((g) => g.id), ["la"]);
  assert.equal(near.radius, 10);
  // The bug this replaces: home-measured buckets in an LA search pick NYC.
  const buggy = nearbyGolfers(FROM_NYC_HOME, 10, 10, noBlocks);
  assert.deepEqual(buggy.golfers.map((g) => g.id), ["nyc"]);
});

test("without server support (or on error, or no coordinates) no golfers are suggested for a temporary area", () => {
  for (const status of ["unsupported", "error"] as TravelDirectoryStatus[]) {
    const source = golferDistanceSource({ temporaryArea: true, isDemo: false, areaHasCoords: true, travelStatus: status });
    assert.equal(source, "hidden", status);
    assert.deepEqual(golfersForSource(source, FROM_NYC_HOME, FROM_LA_SEARCH), []);
    assert.deepEqual(nearbyGolfers(golfersForSource(source, FROM_NYC_HOME, []), 10, 10, noBlocks).golfers, []);
  }
  assert.equal(golferDistanceSource({ temporaryArea: true, isDemo: false, areaHasCoords: false, travelStatus: "ready" }), "hidden");
  // While the area's directory loads, nothing (never the home list in the meantime).
  for (const status of ["idle", "loading"] as TravelDirectoryStatus[]) {
    const source = golferDistanceSource({ temporaryArea: true, isDemo: false, areaHasCoords: true, travelStatus: status });
    assert.equal(source, "pending");
    assert.deepEqual(golfersForSource(source, FROM_NYC_HOME, []), []);
  }
});

test("going back to the saved area uses the home directory again", () => {
  for (const status of ["idle", "loading", "ready", "unsupported", "error"] as TravelDirectoryStatus[]) {
    const source = golferDistanceSource({ temporaryArea: false, isDemo: false, areaHasCoords: true, travelStatus: status });
    assert.equal(source, "home");
    assert.deepEqual(nearbyGolfers(golfersForSource(source, FROM_NYC_HOME, FROM_LA_SEARCH), 10, 10, noBlocks).golfers.map((g) => g.id), ["nyc"]);
  }
  // Demo golfers have fixture coordinates: measured locally, no server.
  assert.equal(golferDistanceSource({ temporaryArea: true, isDemo: true, areaHasCoords: true, travelStatus: "idle" }), "local");
});

test("radius boundaries: a bucket counts only when its whole range fits", () => {
  // 5_to_10 counts at 10 mi, not at 9 (it could be 9.5): widened to 25 instead.
  const mid = candidates([row("mid", "5_to_10")]);
  assert.equal(nearbyGolfers(mid, 10, 10, noBlocks).radius, 10);
  assert.equal(nearbyGolfers(mid, 9, 10, noBlocks).radius, 25);
  assert.equal(nearbyGolfers(candidates([row("near", "within_5")]), 5, 10, noBlocks).radius, 5);
  assert.equal(nearbyGolfers(candidates([row("far", "25_to_50")]), 10, 10, noBlocks).radius, 50);
  assert.deepEqual(nearbyGolfers(candidates([row("very-far", "over_50")]), 10, 10, noBlocks).golfers, []);
  assert.equal(bucketRepresentativeMiles("10_to_15"), 15);
});

test("unknown distance is never inside any radius", () => {
  const unknown = candidates([row("nowhere", null)]);
  assert.equal(unknown[0].distanceMiles, undefined);
  assert.deepEqual(nearbyGolfers(unknown, 50, 10, noBlocks).golfers, []);
});

test("privacy: the search area is sent snapped to its ~5 km cell, never the picked point", () => {
  const a = snapToDirectoryCell({ lat: 34.0522, lng: -118.2437 });
  const b = snapToDirectoryCell({ lat: 34.0999, lng: -118.2001 });
  assert.deepEqual(a, b, "two points in one cell send the same origin");
  assert.deepEqual(a, { lat: 34.075, lng: -118.225 });
  assert.notDeepEqual(snapToDirectoryCell({ lat: 34.1001, lng: -118.2437 }), a, "the next cell differs");
  assert.equal(snapToDirectoryCell({ lat: Number.NaN, lng: 0 }), null);
  assert.equal(snapToDirectoryCell({ lat: 91, lng: 0 }), null);
  assert.equal(snapToDirectoryCell(undefined), null);
  // The fetch snaps before sending and has no table fallback.
  const fetchSrc = strip(read("../src/lib/publicProfilesFetch.ts"));
  const fn = fetchSrc.slice(fetchSrc.indexOf("export async function fetchGolferDirectoryFrom"), fetchSrc.indexOf("export async function fetchMyBlockedProfiles"));
  assert.match(fn, /const origin = snapToDirectoryCell\(area\)/);
  assert.match(fn, /p_origin_lat: origin\.lat/);
  assert.doesNotMatch(fn, /from\("profiles"\)/, "no table fallback for a search area");
  // Results map through the same coordinate-free row type.
  assert.equal(publicProfileRowToGolferProfile(row("la", "within_5")).playingAreaCoords, undefined);
});

test("the temporary area is read from the URL only; the saved area is never touched", () => {
  const home = { areaLabel: "Brooklyn, NY", playingAreaCoords: { lat: 40.68, lng: -73.97 } };
  const user = { ...home } as unknown as Parameters<typeof effectiveLocation>[0];
  const params = new URLSearchParams(locationParams({ label: "Los Angeles, CA", coords: { lat: 34.05, lng: -118.24 } }));
  assert.deepEqual(effectiveLocation(user, params).coords, { lat: 34.05, lng: -118.24 });
  assert.equal(isTemporaryLocation(user, params), true);
  // Clearing the area: back to the saved one.
  assert.deepEqual(effectiveLocation(user, new URLSearchParams()).coords, home.playingAreaCoords);
  assert.equal(isTemporaryLocation(user, new URLSearchParams()), false);
  assert.deepEqual({ areaLabel: user.areaLabel, playingAreaCoords: user.playingAreaCoords }, home, "user object unchanged");
  // Nothing on the travel path writes the profile.
  for (const f of ["../src/lib/travelGolfers.ts", "../src/lib/useTravelGolferDirectory.ts"]) {
    assert.doesNotMatch(strip(read(f)), /updateCurrentUserProfile|saveProfile|from\("profiles"\)/, f);
  }
  // In Auto-Match the only profile write is the explicit "set your location"
  // choice, and a search with its own area returns before reaching it.
  const page = strip(read("../src/pages/AutoMatch.tsx"));
  const choose = page.slice(page.indexOf("async function chooseLocation"), page.indexOf("function golferCards"));
  assert.ok(choose.indexOf("if (locationOverride(searchParams))") < choose.indexOf("updateCurrentUserProfile("));
  // The only other profile write is the Match Preferences quick-picks,
  // whose patches never carry an area.
  const outsideChoose = page.replace(choose, "");
  assert.equal((outsideChoose.match(/updateCurrentUserProfile\(/g) ?? []).length, 1);
  assert.match(outsideChoose, /updateCurrentUserProfile\(s\.patch\)/);
  const quickPicks = page.slice(page.indexOf("const QUICK_PICK_SUGGESTIONS"), page.indexOf("export function AutoMatch"));
  assert.doesNotMatch(quickPicks, /areaLabel|playingAreaCoords/);
});

test("Auto-Match reads golfers through the distance source, and every language explains a hidden list", async () => {
  const page = strip(read("../src/pages/AutoMatch.tsx"));
  assert.match(page, /useTravelGolferDirectory\(effectiveLoc\.coords, temporaryLocation && !isDemo\)/);
  assert.match(page, /golfersForSource\(/);
  assert.match(page, /autoMatch\.golfersHiddenForArea/);
  const { en } = await import("../src/i18n/locales/en.ts");
  const { es } = await import("../src/i18n/locales/es.ts");
  const { ja } = await import("../src/i18n/locales/ja.ts");
  const { ko } = await import("../src/i18n/locales/ko.ts");
  const { zhCN } = await import("../src/i18n/locales/zh-CN.ts");
  const { zhTW } = await import("../src/i18n/locales/zh-TW.ts");
  for (const [name, dict] of Object.entries({ en, es, ja, ko, zhCN, zhTW }) as [string, Record<string, string>][]) {
    assert.ok(dict["autoMatch.golfersHiddenForArea"]?.includes("{area}"), name);
  }
});
