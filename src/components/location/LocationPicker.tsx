import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/FormControls";
import { REGIONS, searchRegions } from "../../data/regions";
import type { Region } from "../../data/regions";
import { haversineMiles } from "../../lib/geo";
import type { GeoPoint, PlayingArea } from "../../lib/geo";
import { coarsenGeoPoint } from "../../lib/coarseLocation";
import { isGeocodeQueryEligible, mergeCityResults, regionToArea } from "../../lib/cityGeocode";
import type { CityArea } from "../../lib/cityGeocode";
import { useCityLookup } from "../../lib/useCityLookup";
import { geocodeLangForLocale, normalizeGeocodeText } from "../../../supabase/functions/_shared/cityGeocode.ts";
import { useLocale } from "../../i18n/LocaleContext";
import { useAuth } from "../../context/AuthContext";
import { localizedAreaLabel, englishPlaceLabel } from "../../lib/placeNames";
import { ensurePlaceNames } from "../../lib/usePlaceNames";

// How close a real geolocation fix needs to be to one of our curated
// region centroids before we're willing to label it with that city name —
// beyond this, still use the real coordinates (course distance/recommend
// still works), just without pretending to know which city it is.
const NEAREST_REGION_LABEL_RADIUS_MILES = 60;

interface LocationPickerProps {
  title?: string;
  onSelect: (area: PlayingArea) => void;
  onClose: () => void;
  /** Immediately triggers "Use My Current Location" on mount — for an
   * onboarding "Use My Location" button that should request the OS
   * permission right away rather than making the user click twice. Still
   * only fires after that explicit tap opened this modal in the first
   * place, never on a silent/automatic mount elsewhere. */
  autoRequestLocation?: boolean;
  /** Ranking hint for worldwide city search (e.g. the saved playing area).
   * Rounded to whole degrees before it leaves the device. */
  biasCoords?: GeoPoint;
}

type GeoStatus = "idle" | "requesting" | "denied" | "unsupported";

function nearestRegion(lat: number, lng: number): Region | undefined {
  let best: Region | undefined;
  let bestDist = Infinity;
  for (const r of REGIONS) {
    const d = haversineMiles({ lat, lng }, r.coords);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best && bestDist <= NEAREST_REGION_LABEL_RADIUS_MILES ? best : undefined;
}

// General area only — city/region granularity, never an exact address.
// Real navigator.geolocation permission flow (no mock), with a graceful,
// non-blocking fallback to manual search when denied/unsupported. Reuses
// the shared Modal, which is already a full-screen sheet on mobile and a
// centered dialog on desktop.
//
// Manual search (global hosting Phase 2): real accounts get worldwide city
// autocomplete through the course-search Edge Function (useCityLookup:
// debounced, 3+ chars, coarsened server-side). The built-in REGIONS list is
// always shown first when it matches and is the whole list in demo mode,
// offline, or whenever city search is unavailable; free text always works.
export function LocationPicker({ title, onSelect, onClose, autoRequestLocation = false, biasCoords }: LocationPickerProps) {
  const { t, locale } = useLocale();
  const { isDemo } = useAuth();
  const [query, setQuery] = useState("");
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const autoRequested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const cityLookup = useCityLookup(query, { enabled: !isDemo, lang: geocodeLangForLocale(locale), bias: biasCoords });
  const trimmedQuery = query.trim();
  const regionMatches = searchRegions(query);
  // Only show geocoded results that answer the current text (a stale
  // "ready" state for a previous query is never mixed in).
  const geocoded = cityLookup.status === "ready" && cityLookup.query.toLowerCase() === normalizeGeocodeText(query).toLowerCase() ? cityLookup.results : [];
  const results: CityArea[] = mergeCityResults(regionMatches, geocoded);
  const exactMatch = results.some((r) => r.label.toLowerCase() === trimmedQuery.toLowerCase());
  const searchingCities = !isDemo && cityLookup.status === "loading" && isGeocodeQueryEligible(query);
  const citySearchUnavailable = !isDemo && cityLookup.status === "unavailable" && isGeocodeQueryEligible(query);

  function requestCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Coarsen before anything else touches the fix — the raw device
        // coordinates never leave this callback (not to the profile, not
        // to course search). See lib/coarseLocation.ts.
        const coords = coarsenGeoPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const region = nearestRegion(coords.lat, coords.lng);
        // Within range of a built-in city: keep that city's id/zone too.
        // Otherwise no place -- a raw fix is not a named city.
        onSelect(region ? { label: region.label, coords, place: regionToArea(region).place } : { label: "Current Location", coords });
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  useEffect(() => {
    if (!autoRequestLocation || autoRequested.current) return;
    autoRequested.current = true;
    requestCurrentLocation();
  }, [autoRequestLocation]);

  async function selectCity(area: CityArea) {
    if (resolvingPlaceId) return;
    // Already coarsened (regionToArea / cityPlaceToArea); coarsen once more
    // so nothing precise can reach a profile from here whatever the source.
    const coords = coarsenGeoPoint(area.coords);
    let label = area.label;
    if (!isDemo && area.place.id.startsWith("geoapify:")) {
      // The searched label is in the SEARCHER's language. Store the English
      // canonical label instead (old clients, text matching and every
      // fallback read area_label) and fill the shared per-city names so other
      // viewers see their own language. Bounded wait; on any failure keep the
      // searched label -- the place id still identifies the city.
      setResolvingPlaceId(area.place.id);
      const names = await ensurePlaceNames(area.place.id);
      if (!mounted.current) return; // closed while resolving: the pick is abandoned
      setResolvingPlaceId(null);
      label = (names && englishPlaceLabel(names, area.place.countryCode)) || area.label;
    }
    onSelect({ label, coords, place: area.place });
  }

  function useFreeTextLabel() {
    if (!trimmedQuery) return;
    onSelect({ label: trimmedQuery });
  }

  return (
    <Modal title={title ?? t("location.defaultTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Button variant="outline" fullWidth icon={<LocateFixed size={16} />} onClick={requestCurrentLocation} disabled={geoStatus === "requesting"}>
          {geoStatus === "requesting" ? t("location.gettingLocation") : t("location.useCurrent")}
        </Button>
        {geoStatus === "denied" && (
          <p className="text-xs text-slate-500">{t("location.denied")}</p>
        )}
        {geoStatus === "unsupported" && <p className="text-xs text-slate-500">{t("location.unsupported")}</p>}

        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-100" /> {t("location.orChoose")} <span className="h-px flex-1 bg-slate-100" />
        </div>

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("location.searchPlaceholder")}
            className={`${inputClass} pl-9`}
          />
        </div>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.place.id}
              onClick={() => void selectCity(r)}
              disabled={resolvingPlaceId !== null}
              aria-busy={resolvingPlaceId === r.place.id}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-fairway-50 disabled:opacity-60"
            >
              <MapPin size={15} className="shrink-0 text-fairway-600" />
              {/* Built-in cities in the viewer's language; geocoded results
                  already come back in it (autocomplete lang). */}
              <span className="flex-1">{r.place.id.startsWith("golfme:") ? localizedAreaLabel({ areaLabel: r.label, place: r.place }, locale, () => undefined) : r.label}</span>
            </button>
          ))}
          {trimmedQuery && !exactMatch && (
            <button
              onClick={useFreeTextLabel}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-fairway-700 transition-colors duration-150 hover:bg-fairway-50"
            >
              <MapPin size={15} className="shrink-0" />
              {t("location.useFreeText", { query: trimmedQuery })}
            </button>
          )}
          {trimmedQuery && !exactMatch && (
            // A free-text area has no coordinates, so distance-based
            // discovery can't place it -- say so instead of silently
            // showing an empty "nearby" list later.
            <p className="px-3 pb-1 text-xs text-slate-400">{t("location.freeTextHint")}</p>
          )}
          {searchingCities && <p className="px-3 py-1 text-xs text-slate-400">{t("location.searchingCities")}</p>}
          {citySearchUnavailable && <p className="px-3 py-1 text-xs text-slate-400">{t("location.citySearchUnavailable")}</p>}
          {results.length === 0 && !trimmedQuery && <p className="px-3 py-2.5 text-sm text-slate-400">{t("location.startTyping")}</p>}
          {/* Geoapify free plan requires Geoapify + OpenStreetMap attribution wherever its results are shown. */}
          {geocoded.length > 0 && <p className="px-3 pt-1 text-[11px] text-slate-400">{t("location.cityAttribution")}</p>}
        </div>
      </div>
    </Modal>
  );
}
