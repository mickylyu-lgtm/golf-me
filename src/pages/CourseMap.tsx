import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, List, Locate, LocateFixed, LocateOff, MapPin, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import { Capacitor } from "@capacitor/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useData } from "../context/DataContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { CourseSearchStatus } from "../components/ui/CourseSearchStatus";
import { LocationPicker } from "../components/location/LocationPicker";
import { CourseDetailContent } from "../components/courses/CourseDetailContent";
import { CourseThumb, type ThumbShown } from "../components/courses/CourseThumb";
import { aerialCredit, courseTileSource } from "../lib/courseImagery";
import { useNearbyCourses } from "../lib/useCourseSearch";
import type { DisplayCourseResult } from "../lib/useCourseSearch";
import { resolveTravelRadiusMiles } from "../lib/matchPreferences";
import { formatDistanceMiles } from "../lib/geo";
import type { PlayingArea } from "../lib/geo";
import { TEE_TIMES_VISIBLE, matchSupportedTeeTimeCourse } from "../services/teeTimes/types";
import { goBack } from "../lib/goBack";
import { initialBrowseArea, withBrowseArea } from "../lib/browseArea";
import { loadMapCamera, prefersReducedMotion, saveMapCamera } from "../lib/courseMapCamera";
import { DEVICE_DOT_PRECISION, accuracyRadiusPx, watchDeviceLocation } from "../lib/deviceLocation";
import type { DeviceFix, LocateProblem } from "../lib/deviceLocation";

// "Golf Courses Near You" as a full-screen map (Micky, 2026-11-04, after
// LINQ Golf's map): one pin per nearby course from the same source as the
// list (useNearbyCourses). Free OpenFreeMap vector tiles (OpenStreetMap
// data, no key, no per-view billing) drawn by MapLibre; this page is
// lazy-loaded, so the map library only downloads when someone opens it.
//
// Interaction (Micky's map brief, same day): tapping a pin glides the
// camera so the pin sits above a preview card that slides up; tapping the
// card opens the course page as a sheet over the same map, as its own
// history entry, so Back / the iOS back swipe / X / dragging it down all
// just close the sheet. The map is created once per visit and never
// rebuilt for a selection, and its camera and selected pin are kept for the
// session, so coming back from Host here returns to the same view.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
// Pins on the map (the lists show the nearest 10).
const MAP_COURSE_LIMIT = 100;
// Camera glide to a tapped pin.
const GLIDE_MS = 450;
// Pins fading in: gap between neighbours, longest total delay, and how long
// to wait for the map's first draw before showing them anyway.
const PIN_STAGGER_MS = 18;
const PIN_STAGGER_MAX_MS = 400;
const PIN_REVEAL_FALLBACK_MS = 2500;
// Dragging the sheet down this far closes it.
const SHEET_CLOSE_DRAG_PX = 90;
// Locate: how far in to zoom (never out) when centring on the device, and
// the smallest accuracy circle worth drawing around the 16 px dot.
const LOCATE_MIN_ZOOM = 11;
const LOCATE_GLIDE_MS = 600;
const ACCURACY_CIRCLE_MIN_PX = 12;

type LocateStatus = "off" | "searching" | "on" | LocateProblem;

const PIN_SVG =
  '<svg viewBox="0 0 24 32" width="100%" height="100%" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill="currentColor" stroke="white" stroke-width="1.5"/><circle cx="12" cy="11.5" r="4.2" fill="white"/></svg>';

// The map card's thumbnail, name and a credit line that names whatever the
// thumbnail is really showing (after any load failure): "Google Maps" must
// be visible wherever a Google photo is shown (the author is on the
// full-size photo in the sheet).
const THUMB_CREDIT: Partial<Record<ThumbShown, string>> = {
  google: "Google Maps",
  wikimedia: "Wikimedia Commons",
  static: "© Mapbox © OpenStreetMap © Maxar",
};

function CardThumbAndName({ course }: { course: DisplayCourseResult }) {
  const [shown, setShown] = useState<ThumbShown>("waiting");
  const source = courseTileSource(course);
  const credit = shown === "tiles" && source ? aerialCredit(source) : (THUMB_CREDIT[shown] ?? null);
  return (
    <>
      <CourseThumb
        name={course.name}
        courseId={course.id}
        imageUrl={matchSupportedTeeTimeCourse(course.name)?.heroImageUrl}
        lat={course.lat}
        lng={course.lng}
        bounds={course.bounds}
        country={course.country}
        sizePx={56}
        className="h-14 w-14"
        onShown={setShown}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold text-slate-900">{course.name}</span>
        {course.area && <span className="block truncate text-sm text-slate-500">{course.area}</span>}
        {/* Always one reserved line, so the card doesn't change height. */}
        <span className="block h-3.5 truncate text-[10px] leading-[14px] text-slate-400">{credit}</span>
      </span>
    </>
  );
}

function courseKey(c: DisplayCourseResult): string {
  return c.id ?? `${c.name}@${c.lat},${c.lng}`;
}

interface CourseMapState {
  area?: PlayingArea;
  // The course whose sheet is open (this history entry only).
  sheet?: string;
}

export function CourseMap() {
  const { currentUser } = useData();
  const { t } = useLocale();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const routeState = (routerLocation.state as CourseMapState | null) ?? {};

  const [area, setArea] = useState<PlayingArea | undefined>(() =>
    initialBrowseArea(
      routeState,
      currentUser.playingAreaCoords ? { label: currentUser.areaLabel, coords: currentUser.playingAreaCoords } : undefined,
    ),
  );
  const lat = area?.coords?.lat;
  const lng = area?.coords?.lng;
  const areaId = lat != null && lng != null ? `${lat.toFixed(4)},${lng.toFixed(4)}` : "";
  // A camera kept from earlier in this session, for this same area.
  const [restored] = useState(() => {
    const saved = loadMapCamera();
    return saved && saved.areaId === areaId ? saved : null;
  });

  const [locationPickerOpen, setLocationPickerOpen] = useState(!area);
  const [selectedKey, setSelectedKey] = useState<string | null>(restored?.selectedKey ?? null);
  const [mapFailed, setMapFailed] = useState(false);

  const radiusMiles = resolveTravelRadiusMiles(currentUser);
  const { results, loading, error, retry } = useNearbyCourses(area, radiusMiles, MAP_COURSE_LIMIT);
  const mapped = results.filter((r) => r.lat != null && r.lng != null);
  const mappedKeys = mapped.map(courseKey).join("|");
  const selected = mapped.find((r) => courseKey(r) === selectedKey) ?? null;
  const sheetCourse = routeState.sheet ? (mapped.find((r) => courseKey(r) === routeState.sheet) ?? null) : null;

  // The card keeps showing the last course while it slides away.
  const [cardCourse, setCardCourse] = useState<DisplayCourseResult | null>(selected);
  if (selected && selected !== cardCourse) setCardCourse(selected);
  // Same for the sheet's content while it slides down.
  const [shownSheetCourse, setShownSheetCourse] = useState<DisplayCourseResult | null>(sheetCourse);
  if (sheetCourse && sheetCourse !== shownSheetCourse) setShownSheetCourse(sheetCourse);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLElement; shape: HTMLElement }>>(new Map());
  const cardRef = useRef<HTMLDivElement>(null);
  // The device's own position (locate button). Held only in these refs and
  // the marker: never React state, never sent or saved (lib/deviceLocation.ts).
  const deviceDotRef = useRef<{ marker: maplibregl.Marker; circle: HTMLElement } | null>(null);
  const deviceFixRef = useRef<DeviceFix | null>(null);
  const sizeAccuracyCircleRef = useRef(() => {});
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const areaIdRef = useRef(areaId);
  areaIdRef.current = areaId;
  // Fit the pins once per area, unless a kept camera is being restored.
  const fittedAreaRef = useRef<string | null>(restored ? areaId : null);

  function rememberCamera() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    saveMapCamera({ areaId: areaIdRef.current, lng: c.lng, lat: c.lat, zoom: map.getZoom(), selectedKey: selectedKeyRef.current });
  }

  // Selecting a pin: highlight it and glide there in the same frame, at the
  // current zoom, with the pin landing above the card. A new glide replaces
  // one still running (MapLibre stops the previous camera animation).
  function selectCourse(key: string, lngLat: [number, number]) {
    setSelectedKey(key);
    const map = mapRef.current;
    if (!map) return;
    const cardHeight = cardRef.current?.offsetHeight || 120;
    map.easeTo({
      center: lngLat,
      offset: [0, -Math.round(cardHeight / 2)],
      duration: prefersReducedMotion() ? 0 : GLIDE_MS,
      essential: false,
    });
  }
  const selectCourseRef = useRef(selectCourse);
  selectCourseRef.current = selectCourse;

  // The map itself: created once, removed on leave.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: restored ? [restored.lng, restored.lat] : [lng ?? -74.006, lat ?? 40.7128],
        zoom: restored?.zoom ?? 9.5,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // No WebGL (rare: old devices, some locked-down browsers): offer the list.
      console.error("GolfMe: the course map could not start.", err);
      setMapFailed(true);
      return;
    }
    // Start collapsed to the (i) button (tap it for the OpenStreetMap
    // credits) rather than a full-width line under the course card.
    map.once("load", () => containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    // No +/- buttons: pinch and double-tap zoom, and the bottom card needs
    // that corner. Tapping empty map closes the card, like the reference.
    map.on("click", () => setSelectedKey(null));
    map.on("moveend", rememberCamera);
    map.on("zoom", () => sizeAccuracyCircleRef.current());
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      rememberCamera();
      markers.clear();
      deviceDotRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different area recentres the map (the first one keeps whatever camera
  // was restored). Keyed on the area id, not "first run", so re-running
  // (React's dev double effects, a remount) never jumps away from a restored
  // camera. The area's centre is NOT drawn as a "you are here" dot any more:
  // it is a search centre (a city centroid, or a fix rounded to ~1 km), and
  // drawn like a GPS dot it read as the device's position (Micky,
  // 2026-11-07: a dot in the harbour for "New York, NY"). The real device
  // position is the locate button's job, below.
  const centredAreaRef = useRef<string | null>(restored ? areaId : null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    if (centredAreaRef.current === areaId) return;
    centredAreaRef.current = areaId;
    map.jumpTo({ center: [lng, lat] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // Locate: a live watch of the device position while the map is open (and
  // in the foreground), drawn as a blue dot with its accuracy circle. Starts
  // only from a tap, stops when the map closes or the app is backgrounded.
  const [locate, setLocate] = useState<LocateStatus>("off");
  const stopWatchRef = useRef<(() => void) | null>(null);
  // Watching was asked for (survives a background pause).
  const wantWatchRef = useRef(false);
  // Centre on the next fix (the tap that started the watch).
  const centreOnFixRef = useRef(false);

  sizeAccuracyCircleRef.current = () => {
    const map = mapRef.current;
    const dot = deviceDotRef.current;
    const fix = deviceFixRef.current;
    if (!map || !dot || !fix) return;
    const r = accuracyRadiusPx(fix.accuracyM, fix.lat, map.getZoom());
    dot.circle.style.display = r < ACCURACY_CIRCLE_MIN_PX ? "none" : "";
    dot.circle.style.width = dot.circle.style.height = `${Math.round(r * 2)}px`;
  };

  function centreOnDevice(fix: DeviceFix) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [fix.lng, fix.lat],
      zoom: Math.max(map.getZoom(), LOCATE_MIN_ZOOM),
      duration: prefersReducedMotion() ? 0 : LOCATE_GLIDE_MS,
      essential: false,
    });
  }

  function removeDeviceDot() {
    deviceDotRef.current?.marker.remove();
    deviceDotRef.current = null;
    deviceFixRef.current = null;
  }

  function showDeviceFix(fix: DeviceFix) {
    const map = mapRef.current;
    if (!map) return;
    deviceFixRef.current = fix;
    if (!deviceDotRef.current) {
      // Taps go through to the map (closing the card), like empty map.
      const el = document.createElement("div");
      el.className = "pointer-events-none relative h-4 w-4";
      el.setAttribute("aria-hidden", "true");
      const circle = document.createElement("div");
      circle.className = "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-500/40 bg-blue-500/15";
      const dot = document.createElement("div");
      dot.className = "absolute inset-0 rounded-full border-[3px] border-white bg-blue-500 shadow-md";
      el.append(circle, dot);
      deviceDotRef.current = { marker: new maplibregl.Marker({ element: el }).setLngLat([fix.lng, fix.lat]).addTo(map), circle };
    } else {
      deviceDotRef.current.marker.setLngLat([fix.lng, fix.lat]);
    }
    sizeAccuracyCircleRef.current();
    if (centreOnFixRef.current) {
      centreOnFixRef.current = false;
      centreOnDevice(fix);
    }
  }

  function startWatch() {
    stopWatchRef.current?.();
    stopWatchRef.current = watchDeviceLocation("geolocation" in navigator ? navigator.geolocation : undefined, DEVICE_DOT_PRECISION, {
      onFix: (fix) => {
        showDeviceFix(fix);
        setLocate("on");
      },
      onProblem: (problem) => {
        // A dropped fix while one is already shown: keep the last dot.
        if (problem === "unavailable" && deviceFixRef.current) return;
        if (problem !== "unavailable") {
          wantWatchRef.current = false;
          stopWatchRef.current = null;
          removeDeviceDot();
        }
        setLocate(problem);
      },
    });
  }

  function stopWatch() {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  }

  function onLocateTap() {
    const fix = deviceFixRef.current;
    if (fix && stopWatchRef.current) {
      centreOnDevice(fix);
      return;
    }
    wantWatchRef.current = true;
    centreOnFixRef.current = true;
    setLocate("searching");
    startWatch();
  }

  useEffect(() => {
    const onVisibility = () => {
      if (!wantWatchRef.current) return;
      if (document.visibilityState === "hidden") stopWatch();
      else if (!stopWatchRef.current) startWatch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wantWatchRef.current = false;
      stopWatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locateMessage =
    locate === "denied"
      ? t(Capacitor.isNativePlatform() ? "courseMap.locateDeniedApp" : "courseMap.locateDeniedWeb")
      : locate === "unavailable"
        ? t("courseMap.locateUnavailable")
        : locate === "unsupported"
          ? t("courseMap.locateUnsupported")
          : null;

  // One pin per course, rebuilt only when the set of courses changes —
  // never for a selection (that only restyles, below).
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
      const lngLat: [number, number] = [course.lng!, course.lat!];
      // MapLibre positions the button with an inline transform on every
      // frame, so the button itself must never transition (pins would trail
      // the map); only the inner shape animates its highlight.
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", course.name);
      el.className = "block h-8 w-6";
      const shape = document.createElement("span");
      // Starts hidden and a little low; revealed below once the map has drawn.
      shape.className =
        "block h-full w-full origin-bottom translate-y-1.5 text-fairway-600 opacity-0 drop-shadow transition-[scale,color,opacity,translate] duration-300 ease-out motion-reduce:transition-none";
      shape.innerHTML = PIN_SVG;
      el.appendChild(shape);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCourseRef.current(key, lngLat);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(lngLat).addTo(map);
      markers.set(key, { marker, el, shape });
      bounds.extend(lngLat);
    }
    if (fittedAreaRef.current !== areaId) {
      fittedAreaRef.current = areaId;
      if (lat != null && lng != null) bounds.extend([lng, lat]);
      try {
        map.fitBounds(bounds, { padding: { top: 140, bottom: 160, left: 40, right: 40 }, maxZoom: 13, duration: 0 });
      } catch {
        // A screen too small for that padding: the pins are still on the map.
      }
    }

    // Fade the pins in (Micky: popping in "looks cheap") only once the map
    // has drawn and the view is already fitted, so they never appear over a
    // blank map or jump with the camera. Nearest first (results come sorted
    // by distance), a few ms apart, so they settle in from the centre out.
    const timers: number[] = [];
    const shapes = [...markers.values()].map((m) => m.shape);
    const reveal = () => {
      const stagger = prefersReducedMotion() ? 0 : PIN_STAGGER_MS;
      shapes.forEach((shape, i) => {
        timers.push(window.setTimeout(() => shape.classList.remove("opacity-0", "translate-y-1.5"), Math.min(i * stagger, PIN_STAGGER_MAX_MS)));
      });
    };
    let revealed = false;
    const revealOnce = () => {
      if (revealed) return;
      revealed = true;
      requestAnimationFrame(reveal);
    };
    if (map.isStyleLoaded()) revealOnce();
    else map.once("load", revealOnce);
    // A slow tile server still gets its pins.
    timers.push(window.setTimeout(revealOnce, PIN_REVEAL_FALLBACK_MS));
    return () => {
      revealed = true;
      map.off("load", revealOnce);
      for (const t of timers) window.clearTimeout(t);
    };
    // Keyed on the result set, not the array identity of each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedKeys]);

  // The selected pin is larger and darker, and drawn above its neighbours.
  useEffect(() => {
    for (const [key, { el, shape }] of markersRef.current) {
      const on = key === selectedKey;
      shape.classList.toggle("scale-125", on);
      shape.classList.toggle("text-brand-forest-deep", on);
      shape.classList.toggle("text-fairway-600", !on);
      el.style.zIndex = on ? "2" : "";
      el.setAttribute("aria-pressed", String(on));
    }
    rememberCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, mappedKeys]);

  function openSheet(course: DisplayCourseResult) {
    const supportedId = TEE_TIMES_VISIBLE ? matchSupportedTeeTimeCourse(course.name)?.id : undefined;
    if (supportedId) {
      // Hand-picked courses keep their own tee-time page (official booking link).
      navigate(`/tee-times/${supportedId}`);
      return;
    }
    navigate("/courses/map", { state: { area, sheet: courseKey(course) } satisfies CourseMapState });
  }
  // The sheet is its own history entry: closing it is a plain Back.
  const closeSheet = () => navigate(-1);

  // Drag the sheet's handle down to close it.
  const [sheetDrag, setSheetDrag] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const sheetHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      dragStartRef.current = e.clientY;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (dragStartRef.current === null) return;
      setSheetDrag(Math.max(0, e.clientY - dragStartRef.current));
    },
    onPointerUp: () => {
      if (dragStartRef.current === null) return;
      dragStartRef.current = null;
      if (sheetDrag > SHEET_CLOSE_DRAG_PX) closeSheet();
      setSheetDrag(0);
    },
    onPointerCancel: () => {
      dragStartRef.current = null;
      setSheetDrag(0);
    },
  };

  const cardShown = selected !== null && !sheetCourse;
  const sheetOpen = sheetCourse !== null;

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
        {locateMessage && (
          <div role="status" className="pointer-events-auto flex items-start gap-2 rounded-2xl bg-white/95 p-3 shadow-md">
            <LocateOff size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <p className="min-w-0 flex-1 text-sm text-slate-600">{locateMessage}</p>
            <button
              onClick={() => setLocate("off")}
              aria-label={t("common.close")}
              className="-m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!mapFailed && (
          <div className="flex justify-end">
            <button
              onClick={onLocateTap}
              aria-label={t("courseMap.locate")}
              aria-pressed={locate === "on"}
              className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-md backdrop-blur transition-colors ${
                locate === "on" ? "text-blue-500" : "text-slate-600 hover:text-fairway-700"
              }`}
            >
              {locate === "on" ? (
                <LocateFixed size={19} />
              ) : (
                <Locate size={19} className={locate === "searching" ? "animate-pulse motion-reduce:animate-none" : undefined} />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Preview card: slides up from the bottom (transform only, so the map
          keeps its frame rate); the map stays usable around it. */}
      <div
        ref={cardRef}
        aria-hidden={!cardShown}
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-[calc(env(safe-area-inset-bottom)+2.75rem)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          cardShown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {cardCourse && (
          <button
            onClick={() => openSheet(cardCourse)}
            tabIndex={cardShown ? 0 : -1}
            className="pointer-events-auto flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-lg transition active:scale-[0.99]"
          >
            <CardThumbAndName key={courseKey(cardCourse)} course={cardCourse} />
            <span className="shrink-0 text-sm font-semibold text-slate-500">
              {cardCourse.distanceMiles != null ? formatDistanceMiles(cardCourse.distanceMiles) : t("nearbyCourses.distanceUnknown")}
            </span>
            <ChevronRight size={18} className="shrink-0 text-slate-400" />
          </button>
        )}
      </div>

      {/* Course details as a sheet over the same map (full height, a strip
          of map left showing at the top). */}
      <div
        role="dialog"
        aria-modal={sheetOpen}
        aria-hidden={!sheetOpen}
        aria-label={shownSheetCourse?.name}
        style={sheetOpen && sheetDrag > 0 ? { transform: `translateY(${sheetDrag}px)`, transition: "none" } : undefined}
        className={`absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-10 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.15)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          sheetOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        <div {...sheetHandlers} className="flex shrink-0 touch-none items-center justify-between px-4 pb-1 pt-2">
          <span className="w-9" />
          <span className="h-1.5 w-10 rounded-full bg-slate-200" />
          <button
            onClick={closeSheet}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t("common.close")}
            tabIndex={sheetOpen ? 0 : -1}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {shownSheetCourse && <CourseDetailContent key={courseKey(shownSheetCourse)} course={shownSheetCourse} />}
        </div>
      </div>

      {locationPickerOpen && (
        <LocationPicker
          title={t("nearbyCourses.title")}
          autoRequestLocation={!area}
          onSelect={(picked) => {
            setArea(picked);
            setSelectedKey(null);
            setLocationPickerOpen(false);
            // Kept on this history entry, so a remount after Back (a tee-time
            // page, Host here) stays on this area and its kept camera.
            navigate("/courses/map", { replace: true, state: withBrowseArea<CourseMapState>(routeState, picked) });
          }}
          onClose={() => setLocationPickerOpen(false)}
        />
      )}
    </div>
  );
}
