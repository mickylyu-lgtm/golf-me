import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/FormControls";
import { REGIONS, searchRegions } from "../../data/regions";
import type { Region } from "../../data/regions";
import { haversineMiles } from "../../lib/geo";
import type { PlayingArea } from "../../lib/geo";
import { coarsenGeoPoint } from "../../lib/coarseLocation";
import { searchRealPlaces } from "../../lib/realCourseSearch";
import type { PlaceSearchResult } from "../../lib/realCourseSearch";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../i18n/LocaleContext";

const PLACE_SEARCH_DEBOUNCE_MS = 300;
const PLACE_SEARCH_MIN_CHARS = 2;

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
export function LocationPicker({ title = "Where do you usually play?", onSelect, onClose, autoRequestLocation = false }: LocationPickerProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const autoRequested = useRef(false);

  const { isDemo } = useAuth();
  const results = searchRegions(query);
  const trimmedQuery = query.trim();

  // Real accounts: anything not in the curated list (a neighbourhood, a
  // town, a zip code) is looked up server-side, debounced. Coordinates come
  // back already rounded to ~1 km. Demo stays on the curated list only.
  const [places, setPlaces] = useState<PlaceSearchResult[]>([]);
  const [placeStatus, setPlaceStatus] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    if (isDemo || trimmedQuery.length < PLACE_SEARCH_MIN_CHARS) {
      setPlaces([]);
      setPlaceStatus("idle");
      return;
    }
    let cancelled = false;
    setPlaceStatus("loading");
    const timer = window.setTimeout(() => {
      searchRealPlaces(trimmedQuery)
        .then((found) => {
          if (cancelled) return;
          setPlaces(found);
          setPlaceStatus("idle");
        })
        .catch(() => {
          if (cancelled) return;
          setPlaces([]);
          setPlaceStatus("error");
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isDemo, trimmedQuery]);
  // A server place with the same label as a curated one is shown once.
  const curatedLabels = new Set(results.map((r) => r.label.toLowerCase()));
  const extraPlaces = places.filter((p) => !curatedLabels.has(p.label.toLowerCase()));
  const exactMatch = [...results.map((r) => r.label), ...extraPlaces.map((p) => p.label)].some((l) => l.toLowerCase() === trimmedQuery.toLowerCase());

  // A location fix that arrives after the sheet was closed is dropped: it
  // used to still apply the location the golfer had walked away from.
  const openRef = useRef(true);
  useEffect(() => {
    openRef.current = true;
    return () => {
      openRef.current = false;
    };
  }, []);

  function requestCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!openRef.current) return;
        // Coarsen before anything else touches the fix — the raw device
        // coordinates never leave this callback (not to the profile, not
        // to course search). See lib/coarseLocation.ts.
        const coords = coarsenGeoPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const region = nearestRegion(coords.lat, coords.lng);
        onSelect({ label: region?.label ?? "Current Location", coords });
      },
      () => openRef.current && setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  useEffect(() => {
    if (!autoRequestLocation || autoRequested.current) return;
    autoRequested.current = true;
    requestCurrentLocation();
  }, [autoRequestLocation]);

  function selectRegion(region: Region) {
    // Region centroids are public, but coarsen them too so what the client
    // holds matches what the server stores (it rounds every write).
    onSelect({ label: region.label, coords: coarsenGeoPoint(region.coords) });
  }

  function selectPlace(place: PlaceSearchResult) {
    onSelect({ label: place.label, coords: coarsenGeoPoint(place.coords) });
  }

  // Name only, no coordinates: kept as a last resort (offline, an area the
  // search doesn't know), with a note saying what it costs.
  function useFreeTextLabel() {
    if (!trimmedQuery) return;
    onSelect({ label: trimmedQuery });
  }

  return (
    <Modal title={title} onClose={onClose} keyboardAware>
      <div className="flex flex-col gap-4">
        <Button variant="outline" fullWidth icon={<LocateFixed size={16} />} onClick={requestCurrentLocation} disabled={geoStatus === "requesting"}>
          {geoStatus === "requesting" ? t("locationPicker.gettingLocation") : t("locationPicker.useCurrent")}
        </Button>
        {geoStatus === "denied" && (
          <p className="text-xs text-slate-500">{t("locationPicker.denied")}</p>
        )}
        {geoStatus === "unsupported" && <p className="text-xs text-slate-500">{t("locationPicker.unsupported")}</p>}

        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-100" /> {t("locationPicker.orChooseManually")} <span className="h-px flex-1 bg-slate-100" />
        </div>

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("locationPicker.searchPlaceholder")}
            className={`${inputClass} pl-9`}
            type="search"
            maxLength={80}
            autoCapitalize="words"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="search"
          />
        </div>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => selectRegion(r)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-fairway-50"
            >
              <MapPin size={15} className="shrink-0 text-fairway-600" />
              <span className="flex-1">{r.label}</span>
              {/* Demo course data is a small fixture; real accounts search every course. */}
              {isDemo && !r.hasCourseCoverage && <span className="shrink-0 text-[11px] font-normal text-slate-400">{t("locationPicker.limitedData")}</span>}
            </button>
          ))}
          {extraPlaces.map((p) => (
            <button
              key={`place-${p.label}`}
              onClick={() => selectPlace(p)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-fairway-50"
            >
              <MapPin size={15} className="shrink-0 text-fairway-600" />
              <span className="flex-1">{p.label}</span>
            </button>
          ))}
          {/* One status line with its space kept while a place search can
              run, and the "use what I typed" row always last: rows no
              longer appear and vanish (shifting the list) on each keystroke. */}
          {!isDemo && trimmedQuery.length >= PLACE_SEARCH_MIN_CHARS && (
            <p aria-live="polite" className={`min-h-8 px-3 py-2 text-xs ${placeStatus === "error" ? "text-slate-500" : "text-slate-400"}`}>
              {placeStatus === "loading" ? t("locationPicker.searchingPlaces") : placeStatus === "error" ? t("locationPicker.placeSearchFailed") : ""}
            </p>
          )}
          {trimmedQuery && !exactMatch && (
            <button
              onClick={useFreeTextLabel}
              className="flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-fairway-50"
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-fairway-700">
                <MapPin size={15} className="shrink-0" />
                {t("locationPicker.useAsArea", { query: trimmedQuery })}
              </span>
              <span className="pl-[25px] text-[11px] leading-snug text-slate-400">{t("locationPicker.nameOnlyNote")}</span>
            </button>
          )}
          {results.length === 0 && !trimmedQuery && <p className="px-3 py-2.5 text-sm text-slate-400">{t("locationPicker.startTyping")}</p>}
        </div>
      </div>
    </Modal>
  );
}
