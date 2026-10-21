// Worldwide city search for the playing-area picker (global hosting Phase 2).
// Pure logic only -- no Supabase import -- so it unit-tests without network or
// env. The network fetcher and React hook live in useCityLookup.ts.
//
// Request discipline (Geoapify credits are shared with course search):
//   - nothing is sent until the query is eligible (3+ chars, 2+ for CJK);
//   - typing is debounced (GEOCODE_DEBOUNCE_MS), and a response that arrives
//     after the query changed is dropped;
//   - each picker session memoizes its own results;
//   - the first failure of any kind (offline, function not deployed yet,
//     migration not applied, rate limit, provider error) switches that
//     picker session to "unavailable": no more requests, the built-in list
//     and free text keep working. Reopening the picker tries again.
import { haversineMiles } from "./geo";
import type { GeoPoint, PlayingArea, PlayingAreaPlace } from "./geo";
import { coarsenGeoPoint } from "./coarseLocation";
import { regionPlaceId } from "../data/regions";
import type { Region } from "../data/regions";
import { isGeocodeQueryEligible, normalizeGeocodeText } from "../../supabase/functions/_shared/cityGeocode.ts";
import type { CityPlaceDto } from "../../supabase/functions/_shared/cityGeocode.ts";

export { isGeocodeQueryEligible };
export type { CityPlaceDto };

export const GEOCODE_DEBOUNCE_MS = 350;
/** A geocoded city this close to a matching built-in region is a duplicate. */
const DUPLICATE_RADIUS_MILES = 25;

/** A picked city, ready for LocationPicker's onSelect. */
export type CityArea = PlayingArea & { coords: GeoPoint; place: PlayingAreaPlace };

export function cityPlaceToArea(dto: CityPlaceDto): CityArea {
  return {
    label: dto.label,
    coords: coarsenGeoPoint({ lat: dto.lat, lng: dto.lng }),
    place: { id: dto.placeId, countryCode: dto.countryCode ?? undefined, timezone: dto.timezone ?? undefined },
  };
}

export function regionToArea(region: Region): CityArea {
  // Region centroids are public, but coarsen them too so what the client
  // holds matches what the server stores (it rounds every write).
  return {
    label: region.label,
    coords: coarsenGeoPoint(region.coords),
    place: { id: regionPlaceId(region), countryCode: region.countryCode, timezone: region.timezone },
  };
}

/** Built-in matches first (instant, curated), then geocoded cities that aren't duplicates of them. */
export function mergeCityResults(regionMatches: Region[], geocoded: CityArea[]): CityArea[] {
  const fromRegions = regionMatches.map(regionToArea);
  const labels = new Set(fromRegions.map((a) => a.label.toLowerCase()));
  const extra = geocoded.filter(
    (g) => !labels.has(g.label.toLowerCase()) && !fromRegions.some((r) => haversineMiles(r.coords, g.coords) < DUPLICATE_RADIUS_MILES),
  );
  return [...fromRegions, ...extra];
}

export type CityLookupStatus = "idle" | "loading" | "ready" | "unavailable";

export interface CityLookupState {
  status: CityLookupStatus;
  /** The normalized query this state answers. */
  query: string;
  results: CityArea[];
}

export const IDLE_CITY_LOOKUP: CityLookupState = { status: "idle", query: "", results: [] };

export type CityFetcher = (query: string) => Promise<CityPlaceDto[]>;

export interface CityLookupOptions {
  fetcher: CityFetcher;
  onChange: (state: CityLookupState) => void;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface CityLookup {
  update: (rawQuery: string) => void;
  /** Cancels any pending/in-flight work. The lookup stays usable (StrictMode remounts). */
  dispose: () => void;
}

export function createCityLookup(options: CityLookupOptions): CityLookup {
  const debounceMs = options.debounceMs ?? GEOCODE_DEBOUNCE_MS;
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const memo = new Map<string, CityArea[]>();
  let timer: unknown = null;
  let generation = 0;
  let unavailable = false;

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  return {
    update(rawQuery) {
      clearTimer();
      const current = ++generation;
      const query = normalizeGeocodeText(rawQuery);
      const key = query.toLowerCase();

      if (unavailable) return options.onChange({ status: "unavailable", query, results: [] });
      if (!isGeocodeQueryEligible(query)) return options.onChange({ status: "idle", query, results: [] });
      const cached = memo.get(key);
      if (cached) return options.onChange({ status: "ready", query, results: cached });

      options.onChange({ status: "loading", query, results: [] });
      timer = schedule(() => {
        timer = null;
        options.fetcher(query).then(
          (dtos) => {
            const results = dtos.map(cityPlaceToArea);
            memo.set(key, results);
            if (current === generation) options.onChange({ status: "ready", query, results });
          },
          () => {
            unavailable = true;
            if (current === generation) options.onChange({ status: "unavailable", query, results: [] });
          },
        );
      }, debounceMs);
    },
    dispose() {
      clearTimer();
      generation++;
    },
  };
}
