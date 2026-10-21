// Viewer-language city labels (global hosting Phase 2, items 3-4). Pure
// logic: no Supabase import, so it unit-tests without network or env. The
// fetch/cache store and React hook live in usePlaceNames.ts.
//
// A golfer's playing area is identified by language-neutral data: place id,
// country code, zone and coarse coords (profiles.playing_area_*). The label
// each VIEWER sees is composed here in the viewer's app language:
//   1. built-in region ("golfme:<id>", or a legacy row whose area_label is
//      exactly a built-in label): names from src/data/regionNames.ts;
//   2. geocoded city ("geoapify:<id>"): names from public.geo_places, in the
//      viewer's language, else English;
//   3. otherwise the stored area_label as-is (free text, raw device
//      location, a place whose names aren't loaded, or any failure).
// Country names come from Intl.DisplayNames, never from the network.
import { REGIONS, findRegionByLabel } from "../data/regions";
import { REGION_NAMES } from "../data/regionNames";
import { placeNameKeyForLocale } from "../../supabase/functions/_shared/cityGeocode.ts";
import type { PlaceNames, PlaceNamesDto } from "../../supabase/functions/_shared/cityGeocode.ts";
import type { PlayingAreaPlace } from "./geo";

// Where a city's own name already says it all.
const CITY_STATES = new Set(["hk", "sg", "mo", "mc", "va", "gi", "bh", "qa", "kw", "lu"]);
// Read naturally as "City, ST" in English/Spanish (matches "New York, NY").
const STATE_CODE_COUNTRIES = new Set(["us", "ca", "au"]);

function separatorFor(locale: string): string {
  if (locale === "ja") return "、";
  if (locale.startsWith("zh")) return "，";
  return ", ";
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

/** Country name in the given app locale, or undefined if Intl can't say. */
export function localizedCountryName(countryCode: string | null | undefined, locale: string): string | undefined {
  if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) return undefined;
  let dn = displayNamesCache.get(locale);
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([locale, "en"], { type: "region", fallback: "none" });
    } catch {
      dn = null;
    }
    displayNamesCache.set(locale, dn);
  }
  try {
    return dn?.of(countryCode.toUpperCase()) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The name to show for a city in `locale`, falling back to English. */
export function pickPlaceName(names: PlaceNames, locale: string): string | undefined {
  return names[placeNameKeyForLocale(locale)] ?? names.en;
}

export function composePlaceLabel(input: { cityName: string; countryCode?: string | null; regionCode?: string | null; locale: string }): string {
  const { cityName, countryCode, regionCode, locale } = input;
  const cc = countryCode?.toLowerCase();
  if (!cc || CITY_STATES.has(cc)) return cityName;
  const latin = locale === "en" || locale === "es";
  if (latin && regionCode && STATE_CODE_COUNTRIES.has(cc)) return `${cityName}, ${regionCode}`;
  const country = localizedCountryName(cc, locale);
  if (!country || country.toLowerCase() === cityName.toLowerCase()) return cityName;
  return `${cityName}${separatorFor(locale)}${country}`;
}

function builtInRegionId(areaLabel: string, place: PlayingAreaPlace | undefined): string | undefined {
  if (place?.id.startsWith("golfme:")) {
    const id = place.id.slice("golfme:".length);
    return REGIONS.some((r) => r.id === id) ? id : undefined;
  }
  // Only a legacy/placeless row: a geoapify place keeps its own identity.
  if (!place) return findRegionByLabel(areaLabel)?.id;
  return undefined;
}

/**
 * The playing-area label a viewer sees, in their app language.
 * `lookup` returns loaded geo_places names for a geoapify id (or undefined).
 */
export function localizedAreaLabel(
  area: { areaLabel: string; place?: PlayingAreaPlace },
  locale: string,
  lookup: (placeId: string) => PlaceNamesDto | null | undefined,
): string {
  const regionId = builtInRegionId(area.areaLabel, area.place);
  if (regionId) {
    const region = REGIONS.find((r) => r.id === regionId)!;
    // English keeps the curated label exactly ("Sydney", "London").
    if (locale === "en") return region.label;
    const names = REGION_NAMES[regionId];
    const cityName = names ? pickPlaceName(names.names, locale) : undefined;
    if (!cityName) return area.areaLabel || region.label;
    return composePlaceLabel({ cityName, countryCode: region.countryCode, regionCode: names?.regionCode, locale });
  }

  if (area.place?.id.startsWith("geoapify:")) {
    const dto = lookup(area.place.id);
    const cityName = dto ? pickPlaceName(dto.names, locale) : undefined;
    if (dto && cityName) {
      return composePlaceLabel({ cityName, countryCode: dto.countryCode ?? area.place.countryCode, regionCode: dto.regionCode, locale });
    }
  }
  return area.areaLabel;
}

/** English canonical label for a geocoded city, stored as area_label so old
 * clients, text matching and every fallback read English. */
export function englishPlaceLabel(dto: PlaceNamesDto, fallbackCountryCode?: string | null): string | undefined {
  if (!dto.names.en) return undefined;
  return composePlaceLabel({ cityName: dto.names.en, countryCode: dto.countryCode ?? fallbackCountryCode, regionCode: dto.regionCode, locale: "en" });
}
