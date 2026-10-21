import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { GeoPoint } from "./geo";
import { createCityLookup, IDLE_CITY_LOOKUP } from "./cityGeocode";
import type { CityLookupState, CityPlaceDto } from "./cityGeocode";
import { sanitizeCityPlaces } from "../../supabase/functions/_shared/cityGeocode.ts";
import type { GeocodeLang } from "../../supabase/functions/_shared/cityGeocode.ts";

class CityGeocodeUnavailableError extends Error {}

// Real accounts only (demo never calls an Edge Function). Any non-success --
// offline, function not deployed with geocode mode yet (400), migration not
// applied (503), rate limit (429), provider error (502) -- is one error type;
// createCityLookup turns it into the "unavailable" fallback state.
async function fetchCityPlaces(query: string, lang: GeocodeLang, bias?: GeoPoint): Promise<CityPlaceDto[]> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new CityGeocodeUnavailableError("offline");
  const { data, error } = await supabase.functions.invoke("course-search", {
    // The bias is only a ranking hint; whole degrees (~100 km) is enough,
    // and the server rounds it the same way.
    body: { mode: "geocode", query, lang, biasLat: bias ? Math.round(bias.lat) : undefined, biasLng: bias ? Math.round(bias.lng) : undefined },
  });
  if (error) throw new CityGeocodeUnavailableError(error.message);
  const body = data as { results?: unknown; error?: string } | null;
  if (!body || body.error || !Array.isArray(body.results)) throw new CityGeocodeUnavailableError("bad response");
  return sanitizeCityPlaces(body.results);
}

export function useCityLookup(query: string, options: { enabled: boolean; lang: GeocodeLang; bias?: GeoPoint }): CityLookupState {
  const { enabled, lang } = options;
  const biasLat = options.bias ? Math.round(options.bias.lat) : undefined;
  const biasLng = options.bias ? Math.round(options.bias.lng) : undefined;
  const [state, setState] = useState<CityLookupState>(IDLE_CITY_LOOKUP);

  const lookup = useMemo(() => {
    if (!enabled) return null;
    const bias = biasLat != null && biasLng != null ? { lat: biasLat, lng: biasLng } : undefined;
    return createCityLookup({ fetcher: (q) => fetchCityPlaces(q, lang, bias), onChange: setState });
  }, [enabled, lang, biasLat, biasLng]);

  useEffect(() => () => lookup?.dispose(), [lookup]);
  useEffect(() => {
    lookup?.update(query);
  }, [lookup, query]);

  return enabled ? state : IDLE_CITY_LOOKUP;
}
