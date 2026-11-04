import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, List, LocateFixed, MapPin } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { CourseSearchStatus } from "../components/ui/CourseSearchStatus";
import { LocationPicker } from "../components/location/LocationPicker";
import { useNearbyCourses } from "../lib/useCourseSearch";
import type { DisplayCourseResult } from "../lib/useCourseSearch";
import { resolveTravelRadiusMiles } from "../lib/matchPreferences";
import { formatDistanceMiles } from "../lib/geo";
import type { PlayingArea } from "../lib/geo";
import { matchSupportedTeeTimeCourse } from "../services/teeTimes/types";
import { openCourse } from "../lib/openCourse";
import { goBack } from "../lib/goBack";

// "Golf Courses Near You" as a full-screen map (Micky, 2026-11-04, after
// LINQ Golf's map): one pin per nearby course from the same source as the
// list (useNearbyCourses), tap a pin for a card, tap the card for the
// course page. Free OpenFreeMap vector tiles (OpenStreetMap data, no key,
// no per-view billing) drawn by MapLibre; this page is lazy-loaded, so the
// map library only downloads when someone opens it.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const PIN_SVG =
  '<svg viewBox="0 0 24 32" width="100%" height="100%" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill="currentColor" stroke="white" stroke-width="1.5"/><circle cx="12" cy="11.5" r="4.2" fill="white"/></svg>';

function courseKey(c: DisplayCourseResult): string {
  return c.id ?? `${c.name}@${c.lat},${c.lng}`;
}

export function CourseMap() {
  const { currentUser } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const passedArea = (routerLocation.state as { area?: PlayingArea } | null)?.area;

  const [area, setArea] = useState<PlayingArea | undefined>(
    passedArea ?? (currentUser.playingAreaCoords ? { label: currentUser.areaLabel, coords: currentUser.playingAreaCoords } : undefined),
  );
  const [locationPickerOpen, setLocationPickerOpen] = useState(!area);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const radiusMiles = resolveTravelRadiusMiles(currentUser);
  const { results, loading, error, retry } = useNearbyCourses(area, radiusMiles);
  const mapped = results.filter((r) => r.lat != null && r.lng != null);
  const selected = mapped.find((r) => courseKey(r) === selectedKey) ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLElement }>>(new Map());
  const hereRef = useRef<maplibregl.Marker | null>(null);

  const lat = area?.coords?.lat;
  const lng = area?.coords?.lng;

  // The map itself: created once, removed on leave.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [lng ?? -74.006, lat ?? 40.7128],
        zoom: 9.5,
        attributionControl: { compact: true },
      });
      // Start collapsed to the (i) button (tap it for the OpenStreetMap
      // credits) rather than a full-width line under the course card.
      map.once("load", () => containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    } catch (err) {
      // No WebGL (rare: old devices, some locked-down browsers): offer the list.
      console.error("GolfMe: the course map could not start.", err);
      setMapFailed(true);
      return;
    }
    // No +/- buttons: pinch and double-tap zoom, and the bottom card needs
    // that corner. Tapping empty map closes the card, like the reference.
    map.on("click", () => setSelectedKey(null));
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      markers.clear();
      hereRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "You are here": the chosen area's centre, and recentre when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    if (!hereRef.current) {
      const el = document.createElement("div");
      el.className = "h-4 w-4 rounded-full border-[3px] border-white bg-blue-500 shadow-[0_0_0_6px_rgba(59,130,246,0.25)]";
      hereRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    } else {
      hereRef.current.setLngLat([lng, lat]);
    }
    map.jumpTo({ center: [lng, lat] });
  }, [lat, lng]);

  // One pin per course; fit them all in view when a new set arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    for (const { marker } of markers.values()) marker.remove();
    markers.clear();
    if (mapped.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const course of mapped) {
      const key = courseKey(course);
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", course.name);
      el.className = "block h-8 w-6 text-fairway-600 transition-transform duration-150 drop-shadow";
      el.innerHTML = PIN_SVG;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedKey(key);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([course.lng!, course.lat!]).addTo(map);
      markers.set(key, { marker, el });
      bounds.extend([course.lng!, course.lat!]);
    }
    if (lat != null && lng != null) bounds.extend([lng, lat]);
    try {
      map.fitBounds(bounds, { padding: { top: 140, bottom: 160, left: 40, right: 40 }, maxZoom: 13, duration: 0 });
    } catch {
      // A screen too small for that padding: the pins are still on the map.
    }
    // Keyed on the result set, not the array identity of each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped.map(courseKey).join("|")]);

  // The selected pin is larger and darker, and drawn above its neighbours.
  useEffect(() => {
    for (const [key, { el }] of markersRef.current) {
      const on = key === selectedKey;
      el.classList.toggle("scale-125", on);
      el.classList.toggle("text-brand-forest-deep", on);
      el.classList.toggle("text-fairway-600", !on);
      el.style.zIndex = on ? "2" : "";
    }
  }, [selectedKey, results]);

  const supported = selected ? matchSupportedTeeTimeCourse(selected.name) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-slate-100">
      {/* MapLibre's stylesheet makes its container position: relative, so
          the full-screen positioning lives on a wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {mapFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-slate-500">{t("courseMap.unavailable")}</p>
          <Button icon={<List size={16} />} onClick={() => navigate("/courses/nearby", { replace: true, state: area ? { area } : undefined })}>
            {t("courseMap.showList")}
          </Button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-2 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-white/95 p-2 shadow-md backdrop-blur">
          <button
            onClick={() => goBack(navigate, "/courses/nearby")}
            aria-label={t("common.back")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
          >
            <ArrowLeft size={18} />
          </button>
          <button onClick={() => setLocationPickerOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <MapPin size={16} className="shrink-0 text-fairway-600" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-slate-900">{area?.label ?? t("nearbyCourses.title")}</span>
              <span className="block text-xs text-slate-400">{t("nearbyCourses.radiusLabel", { radius: radiusMiles })}</span>
            </span>
          </button>
          <button
            onClick={() => navigate("/courses/nearby", { replace: true, state: area ? { area } : undefined })}
            aria-label={t("courseMap.showList")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:border-fairway-300 hover:text-fairway-700"
          >
            <List size={17} />
          </button>
        </div>
        {(loading || error) && (
          <div className="pointer-events-auto rounded-2xl bg-white/95 p-3 shadow-md">
            <CourseSearchStatus loading={loading} error={error} onRetry={retry} />
          </div>
        )}
        {!area && !locationPickerOpen && (
          <div className="pointer-events-auto flex justify-center">
            <Button icon={<LocateFixed size={16} />} onClick={() => setLocationPickerOpen(true)}>
              {t("nearbyCourses.useMyLocation")}
            </Button>
          </div>
        )}
        {area && !loading && !error && mapped.length === 0 && (
          <p className="pointer-events-auto rounded-2xl bg-white/95 p-3 text-center text-sm text-slate-500 shadow-md">{t("nearbyCourses.emptyTitle")}</p>
        )}
      </div>

      {selected && (
        <div className="absolute inset-x-0 bottom-0 px-4 pb-[calc(env(safe-area-inset-bottom)+2.75rem)]">
          <button
            onClick={() => openCourse(navigate, selected, supported?.id)}
            className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-lg transition active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-bold text-slate-900">{selected.name}</span>
              {selected.area && <span className="block truncate text-sm text-slate-500">{selected.area}</span>}
            </span>
            <span className="shrink-0 text-sm font-semibold text-slate-500">
              {selected.distanceMiles != null ? formatDistanceMiles(selected.distanceMiles) : t("nearbyCourses.distanceUnknown")}
            </span>
            <ChevronRight size={18} className="shrink-0 text-slate-400" />
          </button>
        </div>
      )}

      {locationPickerOpen && (
        <LocationPicker
          title={t("nearbyCourses.title")}
          autoRequestLocation={!area}
          onSelect={(picked) => {
            setArea(picked);
            setSelectedKey(null);
            setLocationPickerOpen(false);
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}
