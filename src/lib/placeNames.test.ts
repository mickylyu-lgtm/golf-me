import { describe, expect, it } from "vitest";
import {
  PLACE_NAME_KEYS,
  geoapifyPlaceDetailsParams,
  geoapifyRawPlaceId,
  mapGeoapifyPlaceDetails,
  mapGeoapifyResults,
  placeNameKeyForLocale,
  sanitizePlaceNamesDto,
} from "../../supabase/functions/_shared/cityGeocode.ts";
import type { PlaceNamesDto } from "../../supabase/functions/_shared/cityGeocode.ts";
import { composePlaceLabel, englishPlaceLabel, localizedAreaLabel, localizedCountryName } from "./placeNames";
import { cityPlaceToArea } from "./cityGeocode";
import { REGIONS } from "../data/regions";
import { REGION_NAMES } from "../data/regionNames";
import { FIXTURE_CITIES, FIXTURE_PLACE_DETAILS, RAW_FIXTURE_RESULTS } from "./cityGeocode.fixtures";

const APP_LOCALES = ["en", "es", "ja", "ko", "zh-CN", "zh-TW"] as const;

function placeId(key: string): string {
  const raw = FIXTURE_CITIES.find((c) => c.key === key)!.raw.place_id as string;
  return `geoapify:${raw}`;
}

function namesFor(key: (typeof FIXTURE_CITIES)[number]["key"]): PlaceNamesDto {
  const dto = mapGeoapifyPlaceDetails(FIXTURE_PLACE_DETAILS[key], placeId(key));
  if (!dto) throw new Error(`no names for ${key}`);
  return dto;
}

function country(cc: string, locale: string): string {
  return new Intl.DisplayNames([locale, "en"], { type: "region" }).of(cc.toUpperCase())!;
}

describe("placeNameKeyForLocale", () => {
  it("maps GolfMe's six locales, Simplified vs Traditional Chinese, unknown -> en", () => {
    expect(APP_LOCALES.map(placeNameKeyForLocale)).toEqual(["en", "es", "ja", "ko", "zh-Hans", "zh-Hant"]);
    expect(placeNameKeyForLocale("zh-HK")).toBe("zh-Hant");
    expect(placeNameKeyForLocale("fr")).toBe("en");
    expect(placeNameKeyForLocale(undefined)).toBe("en");
  });
});

describe("mapGeoapifyPlaceDetails", () => {
  it("keeps only GolfMe's six name keys, mapping zh / zh-TW variants", () => {
    const nyc = namesFor("nyc");
    expect(Object.keys(nyc.names).sort()).toEqual([...PLACE_NAME_KEYS].sort());
    expect(nyc.names["zh-Hans"]).toBe("纽约");
    expect(nyc.names["zh-Hant"]).toBe("紐約");
    expect("fr" in nyc.names).toBe(false);
    expect(nyc.regionCode).toBe("NY");
    expect(namesFor("seoul").names["zh-Hant"]).toBe("首爾");
  });

  it("never returns coordinates (the profile already holds the coarse point)", () => {
    for (const c of FIXTURE_CITIES) {
      const dto = namesFor(c.key);
      expect(Object.keys(dto).sort()).toEqual(["countryCode", "names", "placeId", "regionCode"]);
      expect(JSON.stringify(dto)).not.toMatch(/"(lat|lon|lng)"/);
    }
  });

  it("falls back to the base English name and rejects junk", () => {
    const bare = { features: [{ properties: { feature_type: "details", name: "Smalltown", country_code: "nz" } }] };
    expect(mapGeoapifyPlaceDetails(bare, "geoapify:abc")?.names).toEqual({ en: "Smalltown" });
    expect(mapGeoapifyPlaceDetails(bare, "golfme:nyc")).toBeNull();
    expect(mapGeoapifyPlaceDetails(bare, "geoapify:bad id")).toBeNull();
    expect(mapGeoapifyPlaceDetails({ features: [] }, "geoapify:abc")).toBeNull();
    expect(mapGeoapifyPlaceDetails(null, "geoapify:abc")).toBeNull();
    const longName = { features: [{ properties: { feature_type: "details", name: "x".repeat(81) } }] };
    expect(mapGeoapifyPlaceDetails(longName, "geoapify:abc")).toBeNull();
  });

  it("sanitizes a geo_places row (snake_case) the same way", () => {
    const row = { place_id: placeId("tokyo"), names: { en: "Tokyo", ja: "東京都", xx: "nope", ko: 5 }, country_code: "jp", region_code: "bad code" };
    expect(sanitizePlaceNamesDto(row)).toEqual({ placeId: placeId("tokyo"), names: { en: "Tokyo", ja: "東京都" }, countryCode: "jp", regionCode: null });
    expect(sanitizePlaceNamesDto({ place_id: placeId("tokyo"), names: { ja: "東京都" } })).toBeNull(); // English required
    expect(sanitizePlaceNamesDto({ place_id: "evil", names: { en: "x" } })).toBeNull();
  });

  it("builds Place Details params with no key, English base, names feature", () => {
    const p = geoapifyPlaceDetailsParams("51synthTYO0001");
    expect(p.get("id")).toBe("51synthTYO0001");
    expect(p.get("lang")).toBe("en");
    expect(p.get("features")).toBe("details,details.names");
    expect(p.has("apiKey")).toBe(false);
    expect(geoapifyRawPlaceId("geoapify:51synthTYO0001")).toBe("51synthTYO0001");
    expect(geoapifyRawPlaceId("golfme:nyc")).toBeNull();
  });
});

describe("viewer-language labels for the six launch-test cities", () => {
  const dtos = new Map(FIXTURE_CITIES.map((c) => [placeId(c.key), namesFor(c.key)]));
  const lookup = (id: string) => dtos.get(id);
  const area = (key: (typeof FIXTURE_CITIES)[number]["key"]) => {
    const picked = cityPlaceToArea(mapGeoapifyResults(RAW_FIXTURE_RESULTS).find((d) => d.placeId === placeId(key))!);
    return { areaLabel: englishPlaceLabel(dtos.get(picked.place.id)!, picked.place.countryCode)!, place: picked.place };
  };

  it("stores an English canonical label for every city", () => {
    expect(FIXTURE_CITIES.map((c) => area(c.key).areaLabel)).toEqual([
      "New York, NY",
      "Hong Kong",
      "Tokyo, Japan",
      "Seoul, South Korea",
      "London, United Kingdom",
      "Auckland, New Zealand",
    ]);
  });

  it("shows each viewer their own language, falling back to English per city", () => {
    const tokyo = area("tokyo");
    expect(localizedAreaLabel(tokyo, "ja", lookup)).toBe(`東京都、${country("jp", "ja")}`);
    expect(localizedAreaLabel(tokyo, "ko", lookup)).toBe(`도쿄, ${country("jp", "ko")}`);
    expect(localizedAreaLabel(tokyo, "zh-CN", lookup)).toBe(`东京都，${country("jp", "zh-CN")}`);
    expect(localizedAreaLabel(tokyo, "zh-TW", lookup)).toBe(`東京都，${country("jp", "zh-TW")}`);
    expect(localizedAreaLabel(tokyo, "es", lookup)).toBe(`Tokio, ${country("jp", "es")}`);
    expect(localizedAreaLabel(tokyo, "en", lookup)).toBe("Tokyo, Japan");

    // US keeps "City, ST" in Latin-script languages.
    expect(localizedAreaLabel(area("nyc"), "es", lookup)).toBe("Nueva York, NY");
    expect(localizedAreaLabel(area("nyc"), "ko", lookup)).toBe(`뉴욕, ${country("us", "ko")}`);
    // City-state: the name alone.
    expect(localizedAreaLabel(area("hongkong"), "zh-TW", lookup)).toBe("香港");
    expect(localizedAreaLabel(area("hongkong"), "ko", lookup)).toBe("홍콩");
    // London has no zh-Hant name: English city, localized country.
    expect(localizedAreaLabel(area("london"), "zh-TW", lookup)).toBe(`London，${country("gb", "zh-TW")}`);
    // Sparse Auckland: es falls back to English city name.
    expect(localizedAreaLabel(area("auckland"), "es", lookup)).toBe(`Auckland, ${country("nz", "es")}`);
    expect(localizedAreaLabel(area("auckland"), "ja", lookup)).toBe(`オークランド、${country("nz", "ja")}`);
  });

  it("every city x locale yields a non-empty label", () => {
    for (const c of FIXTURE_CITIES) for (const l of APP_LOCALES) expect(localizedAreaLabel(area(c.key), l, lookup).length).toBeGreaterThan(0);
  });

  it("names not loaded (offline, pre-migration, demo) -> the stored English label", () => {
    const tokyo = area("tokyo");
    expect(localizedAreaLabel(tokyo, "ja", () => undefined)).toBe("Tokyo, Japan");
    expect(localizedAreaLabel(tokyo, "ja", () => null)).toBe("Tokyo, Japan");
  });

  it("only ever looks up the area's own place id (no cross-user mixing)", () => {
    const asked: string[] = [];
    const spy = (id: string) => {
      asked.push(id);
      return lookup(id);
    };
    localizedAreaLabel(area("seoul"), "ko", spy);
    localizedAreaLabel({ areaLabel: "My club" }, "ko", spy);
    expect(asked).toEqual([placeId("seoul")]);
  });
});

describe("built-in regions and legacy rows", () => {
  it("every built-in region has names in all six keys", () => {
    for (const r of REGIONS) {
      expect(REGION_NAMES[r.id], r.id).toBeDefined();
      for (const k of PLACE_NAME_KEYS) expect(REGION_NAMES[r.id].names[k], `${r.id}.${k}`).toBeTruthy();
    }
  });

  it("English shows the curated label exactly; other languages localize", () => {
    for (const r of REGIONS) expect(localizedAreaLabel({ areaLabel: r.label, place: { id: `golfme:${r.id}` } }, "en", () => undefined)).toBe(r.label);
    expect(localizedAreaLabel({ areaLabel: "New York, NY", place: { id: "golfme:nyc" } }, "ja", () => undefined)).toBe(`ニューヨーク、${country("us", "ja")}`);
    expect(localizedAreaLabel({ areaLabel: "New York, NY", place: { id: "golfme:nyc" } }, "es", () => undefined)).toBe("Nueva York, NY");
  });

  it("a pre-migration row whose label is exactly a built-in city localizes too", () => {
    expect(localizedAreaLabel({ areaLabel: "Hong Kong" }, "ko", () => undefined)).toBe("홍콩");
    expect(localizedAreaLabel({ areaLabel: "london" }, "zh-CN", () => undefined)).toBe(`伦敦，${country("gb", "zh-CN")}`);
  });

  it("free text and unknown places are never rewritten", () => {
    expect(localizedAreaLabel({ areaLabel: "Brooklyn" }, "ja", () => undefined)).toBe("Brooklyn");
    expect(localizedAreaLabel({ areaLabel: "Current Location" }, "ko", () => undefined)).toBe("Current Location");
    expect(localizedAreaLabel({ areaLabel: "Somewhere", place: { id: "golfme:atlantis" } }, "ja", () => undefined)).toBe("Somewhere");
  });
});

describe("country names", () => {
  it("come from Intl.DisplayNames and degrade to the city alone", () => {
    expect(localizedCountryName("jp", "en")).toBe("Japan");
    expect(localizedCountryName("JPN", "en")).toBeUndefined();
    expect(composePlaceLabel({ cityName: "Tokyo", countryCode: null, locale: "en" })).toBe("Tokyo");
    expect(composePlaceLabel({ cityName: "Singapore", countryCode: "sg", locale: "en" })).toBe("Singapore");
  });
});
