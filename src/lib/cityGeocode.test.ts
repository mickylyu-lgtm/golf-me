import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COUNTRY_CODE_RE,
  PLACE_ID_RE,
  TIMEZONE_RE,
  geoapifyAutocompleteParams,
  geocodeCacheKey,
  geocodeLangForLocale,
  mapGeoapifyResults,
  roundCoordinate,
  sanitizeCityPlaces,
  validateGeocodeRequest,
} from "../../supabase/functions/_shared/cityGeocode.ts";
import type { CityPlaceDto, GeocodeRequest } from "../../supabase/functions/_shared/cityGeocode.ts";
import { coarsenGeoPoint } from "./coarseLocation";
import { cityPlaceToArea, createCityLookup, isGeocodeQueryEligible, mergeCityResults, regionToArea } from "./cityGeocode";
import type { CityLookupState } from "./cityGeocode";
import { REGIONS, searchRegions } from "../data/regions";
import { golferPatchToProfileRow, placeToProfileColumns, profileRowToGolferProfile, profileSupportsPlaceColumns } from "./profile";
import type { ProfileRow } from "./profile";
import { FIXTURE_CITIES, RAW_FIXTURE_RESULTS } from "./cityGeocode.fixtures";

const TWO_DP = /^-?\d+(\.\d{1,2})?$/;

function validRequest(body: unknown): GeocodeRequest {
  const v = validateGeocodeRequest(body);
  if (!v.ok) throw new Error(v.error);
  return v.value;
}

describe("coarsening", () => {
  it("server rounding matches the client's coarsenGeoPoint for every fixture city", () => {
    for (const c of FIXTURE_CITIES) {
      const lat = c.raw.lat as number;
      const lng = c.raw.lon as number;
      expect({ lat: roundCoordinate(lat), lng: roundCoordinate(lng) }).toEqual(coarsenGeoPoint({ lat, lng }));
    }
  });

  it("rounds half away from zero like Postgres round(numeric, 2)", () => {
    expect(roundCoordinate(1.005)).toBe(1.01);
    expect(roundCoordinate(-0.125)).toBe(-0.13);
    expect(roundCoordinate(-36.8485)).toBe(-36.85);
    expect(roundCoordinate(40.7127, 0)).toBe(41);
  });
});

describe("mapGeoapifyResults", () => {
  const mapped = mapGeoapifyResults(RAW_FIXTURE_RESULTS);

  it.each(FIXTURE_CITIES.map((c, i) => [c.key, c, i] as const))("maps %s", (_key, city, i) => {
    const r = mapped[i];
    expect(r.label).toBe(city.expected.label);
    expect(r.lat).toBe(city.expected.lat);
    expect(r.lng).toBe(city.expected.lng);
    expect(r.countryCode).toBe(city.expected.countryCode);
    expect(r.timezone).toBe(city.expected.timezone);
    expect(r.placeId).toBe(`geoapify:${city.raw.place_id as string}`);
    expect(r.placeId).toMatch(PLACE_ID_RE);
  });

  it("never returns more than 2 decimal places", () => {
    for (const r of mapped) {
      expect(String(r.lat)).toMatch(TWO_DP);
      expect(String(r.lng)).toMatch(TWO_DP);
    }
  });

  it("drops malformed results and nulls invalid country/timezone", () => {
    const out = mapGeoapifyResults([
      { ...FIXTURE_CITIES[2].raw, place_id: undefined },
      { ...FIXTURE_CITIES[2].raw, place_id: "bad id!" },
      { ...FIXTURE_CITIES[2].raw, lat: 123 },
      { ...FIXTURE_CITIES[2].raw, name: undefined, city: undefined },
      { ...FIXTURE_CITIES[3].raw, country_code: "KR", timezone: { name: "Not a zone; drop table" } },
      null,
      "x",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Seoul, South Korea");
    expect(out[0].countryCode).toBe("kr");
    expect(out[0].timezone).toBeNull();
  });

  it("dedupes identical labels and caps the list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...FIXTURE_CITIES[0].raw, place_id: `p${i}`, city: `Town ${i}` }));
    expect(mapGeoapifyResults([FIXTURE_CITIES[4].raw, { ...FIXTURE_CITIES[4].raw, place_id: "dup" }])).toHaveLength(1);
    expect(mapGeoapifyResults(many)).toHaveLength(6);
  });

  it("handles non-array input", () => {
    expect(mapGeoapifyResults(undefined)).toEqual([]);
    expect(mapGeoapifyResults({ results: [] })).toEqual([]);
  });

  it("keeps non-Latin names (Japanese-language results)", () => {
    const out = mapGeoapifyResults([{ ...FIXTURE_CITIES[2].raw, city: "東京都", country: "日本" }]);
    expect(out[0].label).toBe("東京都, 日本");
  });
});

describe("validateGeocodeRequest", () => {
  it("enforces minimum length (3, or 2 for CJK) and maximum length", () => {
    expect(validateGeocodeRequest({ query: "ab" }).ok).toBe(false);
    expect(validateGeocodeRequest({ query: "  To  " }).ok).toBe(false);
    expect(validateGeocodeRequest({ query: "Tok" }).ok).toBe(true);
    expect(validateGeocodeRequest({ query: "東京" }).ok).toBe(true);
    expect(validateGeocodeRequest({ query: "서울" }).ok).toBe(true);
    expect(validateGeocodeRequest({ query: "香" }).ok).toBe(false);
    expect(validateGeocodeRequest({ query: "a".repeat(81) }).ok).toBe(false);
    expect(validateGeocodeRequest({ query: 42 }).ok).toBe(false);
    expect(validateGeocodeRequest(null).ok).toBe(false);
  });

  it("normalizes whitespace and maps the app locale to a Geoapify lang", () => {
    const req = validRequest({ query: "  Hong   Kong ", lang: "zh-TW" });
    expect(req.query).toBe("Hong Kong");
    expect(req.normalized).toBe("hong kong");
    expect(req.lang).toBe("zh");
    expect(geocodeLangForLocale("fr")).toBe("en");
    expect(geocodeLangForLocale(undefined)).toBe("en");
  });

  it("rounds the proximity bias to whole degrees and rejects bad values", () => {
    expect(validRequest({ query: "Springfield", biasLat: 40.71, biasLng: -74.01 }).bias).toEqual({ lat: 41, lng: -74 });
    expect(validRequest({ query: "Springfield", biasLat: -0.2, biasLng: 0.4 }).bias).toEqual({ lat: 0, lng: 0 });
    expect(validateGeocodeRequest({ query: "Springfield", biasLat: 91, biasLng: 0 }).ok).toBe(false);
    expect(validateGeocodeRequest({ query: "Springfield", biasLat: 10 }).ok).toBe(false);
  });
});

describe("geocodeCacheKey", () => {
  it("is a deterministic SHA-256 hex that never contains the query text", async () => {
    const a = await geocodeCacheKey(validRequest({ query: "Auckland", lang: "en" }));
    const b = await geocodeCacheKey(validRequest({ query: "  auckland ", lang: "en" }));
    const c = await geocodeCacheKey(validRequest({ query: "Auckland", lang: "ja" }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("auckland");
  });
});

describe("geoapifyAutocompleteParams", () => {
  it("asks for cities only, as JSON, lon,lat bias order, and never includes a key", () => {
    const p = geoapifyAutocompleteParams(validRequest({ query: "London", lang: "en", biasLat: 51.5, biasLng: -0.1 }));
    expect(p.get("type")).toBe("city");
    expect(p.get("format")).toBe("json");
    expect(p.get("limit")).toBe("6");
    expect(p.get("bias")).toBe("proximity:0,52");
    expect(p.get("apiKey")).toBeNull();
  });
});

describe("sanitizeCityPlaces (client/cache side)", () => {
  it("re-coarsens and drops anything that doesn't look like a city place", () => {
    const out = sanitizeCityPlaces([
      { placeId: "geoapify:abc", label: "Tokyo, Japan", lat: 35.6895, lng: 139.6917, countryCode: "jp", timezone: "Asia/Tokyo" },
      { placeId: "evil:abc", label: "X", lat: 1, lng: 1 },
      { placeId: "geoapify:abc2", label: "y".repeat(81), lat: 1, lng: 1 },
      { placeId: "geoapify:abc3", label: "Nowhere", lat: "1", lng: 1 },
      { placeId: "geoapify:abc4", label: "Odd", lat: 1, lng: 1, countryCode: "USA", timezone: "../etc" },
    ]);
    expect(out.map((p) => p.label)).toEqual(["Tokyo, Japan", "Odd"]);
    expect(out[0]).toMatchObject({ lat: 35.69, lng: 139.69 });
    expect(out[1]).toMatchObject({ countryCode: null, timezone: null });
    expect(sanitizeCityPlaces("nope")).toEqual([]);
  });
});

describe("isGeocodeQueryEligible", () => {
  it("applies the same rule on the client", () => {
    expect(isGeocodeQueryEligible("")).toBe(false);
    expect(isGeocodeQueryEligible("Se")).toBe(false);
    expect(isGeocodeQueryEligible("Seo")).toBe(true);
    expect(isGeocodeQueryEligible("서울")).toBe(true);
    expect(isGeocodeQueryEligible("東京")).toBe(true);
  });
});

describe("createCityLookup", () => {
  const dto = (i: number): CityPlaceDto => mapGeoapifyResults(RAW_FIXTURE_RESULTS)[i];
  let states: CityLookupState[];

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
  });
  afterEach(() => vi.useRealTimers());

  it("debounces typing into a single request for the final text", async () => {
    const fetcher = vi.fn(async () => [dto(2)]);
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    for (const q of ["T", "To", "Tok", "Toky", "Tokyo"]) {
      lookup.update(q);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("Tokyo");
    const last = states.at(-1)!;
    expect(last.status).toBe("ready");
    expect(last.results[0]).toMatchObject({ label: "Tokyo, Japan", coords: { lat: 35.69, lng: 139.69 }, place: { countryCode: "jp", timezone: "Asia/Tokyo" } });
  });

  it("stays idle below the minimum length and never calls the fetcher", async () => {
    const fetcher = vi.fn(async () => [dto(0)]);
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    lookup.update("NY");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(states.at(-1)!.status).toBe("idle");
  });

  it("memoizes results within a picker session", async () => {
    const fetcher = vi.fn(async () => [dto(5)]);
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    lookup.update("Auckland");
    await vi.advanceTimersByTimeAsync(400);
    lookup.update("Aucklan");
    await vi.advanceTimersByTimeAsync(400);
    lookup.update("auckland ");
    expect(states.at(-1)!.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("drops a response that arrives after the query changed", async () => {
    let resolveFirst: (v: CityPlaceDto[]) => void = () => {};
    const fetcher = vi
      .fn<(q: string) => Promise<CityPlaceDto[]>>()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => [dto(4)]);
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    lookup.update("Seoul");
    await vi.advanceTimersByTimeAsync(400);
    lookup.update("London");
    resolveFirst([dto(3)]);
    await vi.advanceTimersByTimeAsync(400);
    const ready = states.filter((s) => s.status === "ready");
    expect(ready).toHaveLength(1);
    expect(ready[0].query).toBe("London");
  });

  it("falls back to 'unavailable' on the first failure and stops calling", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("429");
    });
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    lookup.update("Hong Kong");
    await vi.advanceTimersByTimeAsync(400);
    expect(states.at(-1)!.status).toBe("unavailable");
    lookup.update("Tokyo");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(states.at(-1)!.status).toBe("unavailable");
  });

  it("dispose cancels a pending request but the lookup stays usable", async () => {
    const fetcher = vi.fn(async () => [dto(1)]);
    const lookup = createCityLookup({ fetcher, onChange: (s) => states.push(s) });
    lookup.update("Hong Kong");
    lookup.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    lookup.update("Hong Kong");
    await vi.advanceTimersByTimeAsync(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("mergeCityResults (built-in list fallback)", () => {
  const geo = mapGeoapifyResults(RAW_FIXTURE_RESULTS).map(cityPlaceToArea);

  it("puts built-in matches first and drops geocoded duplicates of them", () => {
    const london = geo.filter((g) => g.label.startsWith("London"));
    const merged = mergeCityResults(searchRegions("London"), london);
    expect(merged).toHaveLength(1);
    expect(merged[0].place.id).toBe("golfme:london");
  });

  it("appends cities the built-in list doesn't have", () => {
    const tokyo = geo.filter((g) => g.label.startsWith("Tokyo"));
    const merged = mergeCityResults(searchRegions("Tokyo"), tokyo);
    expect(merged.map((m) => m.label)).toEqual(["Tokyo, Japan"]);
  });

  it("with no geocoder (offline/demo/unavailable) is just the built-in list", () => {
    expect(mergeCityResults(searchRegions("Hong"), []).map((m) => m.place.id)).toEqual(["golfme:hongkong"]);
    expect(mergeCityResults(searchRegions(""), [])).toHaveLength(REGIONS.length);
  });

  it("every built-in region carries a valid id, country and zone", () => {
    for (const r of REGIONS) {
      const a = regionToArea(r);
      expect(a.place.id).toMatch(PLACE_ID_RE);
      expect(a.place.countryCode).toMatch(COUNTRY_CODE_RE);
      expect(a.place.timezone).toMatch(TIMEZONE_RE);
      expect(String(a.coords.lat)).toMatch(TWO_DP);
      expect(String(a.coords.lng)).toMatch(TWO_DP);
    }
  });
});

describe("profile writes before/after the migration", () => {
  const tokyo = cityPlaceToArea(mapGeoapifyResults(RAW_FIXTURE_RESULTS)[2]);

  it("detects the place columns from the select('*') row", () => {
    expect(profileSupportsPlaceColumns(null)).toBe(false);
    expect(profileSupportsPlaceColumns({ id: "u" } as Partial<ProfileRow>)).toBe(false);
    expect(profileSupportsPlaceColumns({ id: "u", playing_area_place_id: null } as Partial<ProfileRow>)).toBe(true);
  });

  it("never sends place columns before the migration", () => {
    const row = golferPatchToProfileRow({ areaLabel: tokyo.label, playingAreaCoords: tokyo.coords, playingAreaPlace: tokyo.place });
    expect(Object.keys(row).sort()).toEqual(["area_label", "playing_area_lat", "playing_area_lng"]);
  });

  it("sends them after, and clears them when the area moves without a place", () => {
    const withPlace = golferPatchToProfileRow({ areaLabel: tokyo.label, playingAreaCoords: tokyo.coords, playingAreaPlace: tokyo.place }, { placeColumns: true });
    expect(withPlace).toMatchObject({ playing_area_place_id: tokyo.place.id, playing_area_country_code: "jp", playing_area_timezone: "Asia/Tokyo" });
    const freeText = golferPatchToProfileRow({ areaLabel: "My club", playingAreaCoords: undefined }, { placeColumns: true });
    expect(freeText).toMatchObject({ playing_area_place_id: null, playing_area_country_code: null, playing_area_timezone: null });
    const unrelated = golferPatchToProfileRow({ bio: "hi" }, { placeColumns: true });
    expect("playing_area_place_id" in unrelated).toBe(false);
  });

  it("drops malformed place values instead of failing the save", () => {
    expect(placeToProfileColumns({ id: "nope", countryCode: "jp", timezone: "Asia/Tokyo" })).toEqual({
      playing_area_place_id: null,
      playing_area_country_code: null,
      playing_area_timezone: null,
    });
    expect(placeToProfileColumns({ id: "golfme:nyc", countryCode: "USA", timezone: "America/New_York" })).toEqual({
      playing_area_place_id: "golfme:nyc",
      playing_area_country_code: null,
      playing_area_timezone: "America/New_York",
    });
  });

  it("reads the place back from a row", () => {
    const row = {
      id: "u",
      name: "A",
      playing_area_lat: 35.69,
      playing_area_lng: 139.69,
      playing_area_place_id: tokyo.place.id,
      playing_area_country_code: "jp",
      playing_area_timezone: "Asia/Tokyo",
    } as unknown as ProfileRow;
    expect(profileRowToGolferProfile(row).playingAreaPlace).toEqual({ id: tokyo.place.id, countryCode: "jp", timezone: "Asia/Tokyo" });
    expect(profileRowToGolferProfile({ ...row, playing_area_place_id: undefined } as unknown as ProfileRow).playingAreaPlace).toBeUndefined();
  });
});
