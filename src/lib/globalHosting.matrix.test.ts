// Global hosting Phase 2 readiness matrix (items 5 and 10f/g): the parts
// that can be proven without a database or the network. Synthetic data
// only. The manual staging checklist for the rest is in
// docs/GLOBAL_HOSTING_ROLLOUT.md.
import { describe, expect, it } from "vitest";
import type { GolfCall, GolferProfile } from "../types";
import { effectiveLocation, isTemporaryLocation, locationParams } from "./travelLocation";
import { resolveCallDistanceMiles } from "./courseSearch";
import { cityPlaceToArea, createCityLookup, mergeCityResults } from "./cityGeocode";
import type { CityLookupState } from "./cityGeocode";
import { mapGeoapifyResults } from "../../supabase/functions/_shared/cityGeocode.ts";
import { searchRegions } from "../data/regions";
import { isInFoundingZone } from "./founder";
import { FIXTURE_CITIES, RAW_FIXTURE_RESULTS } from "./cityGeocode.fixtures";

// Raw source via Vite's glob (no Node types needed in the app tsconfig).
// Keys are normalized to repo-relative paths ("src/...", "supabase/...").
const RAW: Record<string, string> = {};
const globs: Record<string, string>[] = [
  import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  import.meta.glob("../../supabase/functions/{course-search/index.ts,_shared/cityGeocode.ts}", { query: "?raw", import: "default", eager: true }),
  import.meta.glob("../../supabase/migrations/20261021120000_profiles_playing_area_place_and_geocode.sql", { query: "?raw", import: "default", eager: true }),
];
for (const g of globs) for (const [k, v] of Object.entries(g)) RAW[k.replace(/^\.\.\/\.\.\//, "").replace(/^\.\.\//, "src/").replace(/^\.\//, "src/lib/")] = v;
const read = (rel: string) => {
  const v = RAW[rel];
  if (v === undefined) throw new Error(`not loaded: ${rel}`);
  return v;
};

const CITIES = mapGeoapifyResults(RAW_FIXTURE_RESULTS).map(cityPlaceToArea);
const byKey = Object.fromEntries(FIXTURE_CITIES.map((c, i) => [c.key, CITIES[i]]));

const nycUser = {
  id: "viewer",
  areaLabel: "New York, NY",
  playingAreaCoords: { lat: 40.71, lng: -74.01 },
  playingAreaPlace: { id: "golfme:nyc", countryCode: "us", timezone: "America/New_York" },
} as unknown as GolferProfile;

function roundAt(lat: number, lng: number, distanceFromSavedArea?: number): GolfCall {
  return { id: `r-${lat},${lng}`, course: "Synthetic Course", courseCoords: { lat, lng }, distanceMiles: distanceFromSavedArea } as unknown as GolfCall;
}

describe("10f: nearby-round distance is measured from the SEARCHED city", () => {
  for (const c of FIXTURE_CITIES) {
    it(`${c.key}: a round ~10 km away is near; a round in NYC is not (unless searching NYC)`, () => {
      const searched = byKey[c.key];
      const params = new URLSearchParams(locationParams(searched));
      const loc = effectiveLocation(nycUser, params);
      expect(loc.coords).toEqual(searched.coords);

      const near = roundAt(searched.coords.lat + 0.09, searched.coords.lng); // ~10 km north
      const d = resolveCallDistanceMiles(near, loc)!;
      expect(d).toBeGreaterThan(5);
      expect(d).toBeLessThan(8);

      const nycRound = roundAt(40.75, -73.98, 3); // 3 mi from the SAVED area
      const dNyc = resolveCallDistanceMiles(nycRound, loc)!;
      if (c.key === "nyc") expect(dNyc).toBeLessThan(5);
      else expect(dNyc).toBeGreaterThan(2000); // not the stale 3 mi
    });
  }

  it("without a search the saved area is used", () => {
    const loc = effectiveLocation(nycUser, new URLSearchParams());
    expect(loc).toEqual({ label: "New York, NY", coords: nycUser.playingAreaCoords });
    expect(isTemporaryLocation(nycUser, new URLSearchParams())).toBe(false);
  });
});

describe("item 5: browsing another city never writes the profile location", () => {
  it("effectiveLocation / locationParams are pure and leave the profile untouched", () => {
    const before = JSON.stringify(nycUser);
    const params = new URLSearchParams(locationParams(byKey.tokyo));
    effectiveLocation(nycUser, params);
    expect(isTemporaryLocation(nycUser, params)).toBe(true);
    expect(JSON.stringify(nycUser)).toBe(before);
    // Only label + coarse coords travel in the URL; no place id, zone or user data.
    expect(Object.keys(locationParams(byKey.tokyo)).sort()).toEqual(["loc", "locLat", "locLng"]);
  });

  // Source audit: every place that writes a playing area to the profile.
  // Adding one must be a deliberate, reviewed change to this list.
  const files = Object.keys(RAW).filter((f) => f.startsWith("src/") && !/\.test\.ts$|\.fixtures\.ts$/.test(f));

  it("only the three deliberate profile-location actions write it", () => {
    const writers = files.filter((f) =>
      /updateCurrentUserProfile\(\{[^}]*\b(areaLabel|playingAreaCoords|playingAreaPlace)\b/s.test(read(f)),
    );
    expect(writers.sort()).toEqual(["src/components/find/FindRoundModal.tsx", "src/pages/MatchPreferencesDetail.tsx"].sort());
    // Onboarding writes the row directly (the profile's first save).
    const rawWriters = files.filter((f) => f !== "src/lib/profile.ts" && /playing_area_lat\s*:/.test(read(f)));
    expect(rawWriters).toEqual(["src/pages/ProfileSetup.tsx"]);
  });

  it("FindRoundModal writes only from the explicit 'Set as my default' handler", () => {
    const src = read("src/components/find/FindRoundModal.tsx");
    const start = src.indexOf("function setTravelLocationAsDefault()");
    const end = src.indexOf("\n  }\n", start);
    const handler = src.slice(start, end);
    expect(handler).toMatch(/updateCurrentUserProfile\(\{\s*areaLabel/);
    const rest = src.slice(0, start) + src.slice(end);
    expect(rest).not.toMatch(/updateCurrentUserProfile\(\{[^}]*\b(areaLabel|playingAreaCoords|playingAreaPlace)\b/s);
    // The picker's onSelect there only sets local state.
    expect(src).toMatch(/onSelect=\{\(area\) => \{\s*setTravelLocation\(area\);/);
  });

  it("browse-only screens never write the profile", () => {
    for (const f of ["src/pages/NearbyCourses.tsx", "src/components/courses/NearbyCoursesHomeCard.tsx", "src/pages/GolfCalls.tsx", "src/components/location/LocationPicker.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/updateCurrentUserProfile|saveProfile|from\("profiles"\)/);
    }
  });

  it("the Edge Function never touches profiles (server cannot move a location)", () => {
    for (const f of ["supabase/functions/course-search/index.ts", "supabase/functions/_shared/cityGeocode.ts"]) {
      expect(read(f), f).not.toMatch(/["'`]profiles["'`]/);
    }
  });
});

describe("10f: offline / error fallback per city", () => {
  it("built-in list covers NYC, Hong Kong and London offline; others fall back to free text", () => {
    expect(searchRegions("new york").map((r) => r.id)).toEqual(["nyc"]);
    expect(searchRegions("hong").map((r) => r.id)).toEqual(["hongkong"]);
    expect(searchRegions("london").map((r) => r.id)).toEqual(["london"]);
    for (const q of ["tokyo", "seoul", "auckland"]) expect(mergeCityResults(searchRegions(q), [])).toEqual([]);
  });

  it("a geocoded NYC/HK/London result is deduped against the built-in city", () => {
    for (const key of ["nyc", "hongkong", "london"] as const) {
      const merged = mergeCityResults(searchRegions(key === "hongkong" ? "hong" : key === "nyc" ? "new york" : key), [byKey[key]]);
      expect(merged).toHaveLength(1);
      expect(merged[0].place.id.startsWith("golfme:")).toBe(true);
    }
  });

  it("a 429 (rate limit) or offline error stops further requests for the session", async () => {
    const states: CityLookupState[] = [];
    let calls = 0;
    const lookup = createCityLookup({
      fetcher: async () => {
        calls++;
        throw new Error("429");
      },
      onChange: (s) => states.push(s),
      debounceMs: 0,
    });
    lookup.update("Tokyo");
    await new Promise((r) => setTimeout(r, 5));
    lookup.update("Seoul");
    lookup.update("Auckland");
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);
    expect(states.at(-1)?.status).toBe("unavailable");
  });
});

describe("10g: geo-privacy", () => {
  it("every picked city is at most 2 dp before it can reach a profile or a URL", () => {
    for (const a of CITIES) {
      for (const v of [a.coords.lat, a.coords.lng]) expect(String(v)).toMatch(/^-?\d+(\.\d{1,2})?$/);
      for (const v of Object.values(locationParams(a)).slice(1)) expect(v).toMatch(/^-?\d+(\.\d{1,2})?$/);
    }
  });

  it("Founding display zone: only the NYC fixture is inside it", () => {
    const inside = FIXTURE_CITIES.filter((c) => isInFoundingZone(byKey[c.key].coords)).map((c) => c.key);
    expect(inside).toEqual(["nyc"]);
  });
});

describe("10c: migration is additive-only with RLS on every new table", () => {
  const sql = read("supabase/migrations/20261021120000_profiles_playing_area_place_and_geocode.sql")
    .split("\n")
    .filter((l: string) => !l.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();

  it("has no destructive or data-rewriting statements", () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function|policy|trigger|index|schema)\b/);
    expect(sql).not.toMatch(/\balter\s+column\b|\brename\b|\btruncate\b/);
    expect(sql).not.toMatch(/\bupdate\s+public\.profiles\b|\bdelete\s+from\s+public\./);
    expect(sql).not.toMatch(/founding|award|reputation|user_roles/);
    // New profile columns are nullable with no default (metadata-only ADD COLUMN).
    for (const m of sql.matchAll(/add column (\w+) ([^,;]+)/g)) {
      expect(m[2], m[1]).not.toMatch(/not null|default/);
    }
  });

  it("enables RLS on every table it creates and grants nothing to anon", () => {
    const tables = [...sql.matchAll(/create table ([\w.]+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["private.geocode_cache", "private.geocode_rate_buckets", "public.geo_places"]);
    for (const t of tables) expect(sql).toContain(`alter table ${t} enable row level security`);
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
    expect(sql).toMatch(/revoke execute on function public\.geocode_cache_get\(text\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on table public\.geo_places from public, anon, authenticated/);
  });

  it("quota limits match the documented 60/hour, 200/day, 2000/day global, cost 1..5", () => {
    expect(sql).toMatch(/v_hour_count \+ p_cost > 60 or v_day_count \+ p_cost > 200/);
    expect(sql).toMatch(/v_global_count \+ p_cost > 2000/);
    expect(sql).toMatch(/p_cost < 1 or p_cost > 5/);
    expect(sql).toMatch(/v_uid uuid := auth\.uid\(\)/);
  });
});
