import { useEffect, useRef, useState } from "react";
import type { GeoJSONSourceSpecification, LayerSpecification, Map as MaplibreMap, Marker } from "maplibre-gl";
import { Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { detailReveal } from "../../lib/naipExport";
import { courseLayout, coursePicture, loadDetailPicture, type DetailLoad, type DetailPicture, type LayoutResult } from "../../lib/courseDetailImagery";
import { layoutBounds, layoutToGeoJSON, reframeOnLayout } from "../../../supabase/functions/_shared/courseLayout.ts";
import { OSM_CREDIT_HTML, type TileSource } from "../../lib/satelliteTiles";
import {
  ORBIT_DEG_PER_SEC,
  OVERVIEW_PITCH,
  STILL_BEARING,
  maplibreZoom,
  orbitRunning,
  orbitStep,
  overviewMotion,
  overviewTileSize,
  overviewZoomCap,
  type OverviewMotion,
} from "../../lib/droneOrbit";
import { overviewFraming, validBounds, type CourseBounds } from "../../../supabase/functions/_shared/courseBounds.ts";
import { layoutUiStatus, pictureRescueWait, readLayoutPreference, writeLayoutPreference, type LayoutUiStatus } from "../../lib/overviewStatus";

interface CourseOverviewMapProps {
  lat: number;
  lng: number;
  /** The course's OSM outline: the orbit circles its centre, framed to fit.
   * Without it, our point, a little wide. */
  bounds?: CourseBounds | null;
  name: string;
  /** public.courses id (real courses): the detail comes from course-photos. */
  courseId?: string;
  /** Real account with a real course: ask course-photos, not the providers. */
  useServer: boolean;
  /** Aerial tiles: USGS NAIP (US, no key, to z16; MapLibre scales them up
   * closer in) or MapTiler when keyed. */
  source: TileSource;
  /** The live map can't run (style/tiles refused, WebGL lost): the parent
   * switches to the still satellite view. */
  onFail: () => void;
}

// The "drone shot" (Micky, 2026-11-05): aerial imagery (USGS NAIP for US
// courses, MapTiler when keyed) in MapLibre, tilted to pitch 45 (was 60
// until 2026-11-06) and slowly circling the course. The camera never goes
// more than 0.3 zoom past the source's deepest tiles (USGS: 16) and retina
// screens get USGS tiles at native density (lib/droneOrbit overviewZoomCap /
// overviewTileSize). Drag or pinch to look around; that pauses the circling,
// which carries on from there after a few seconds. Reduced motion: the same
// tilted view, still. It circles the centre of the course's OpenStreetMap
// outline, zoomed to fit it; without an outline it circles our point, a
// little wider.
//
// Cost: MapLibre (~800 KB) downloads only when a course page opens; the map
// is created only once the box is on screen and removed on leave; the camera
// stops while it's off screen or the app is in the background.
//
// Detail (2026-11-06, reworked 2026-11-07 for speed and privacy):
//   * USGS courses: one sharp NAIP picture (lib/courseDetailImagery
//     coursePicture): asked for when the page opens, in parallel with the
//     tiles; for real courses a warm Storage URL from course-photos, else
//     the USGS export. Downloaded once (blob: URL shared with the still
//     view), at low priority, laid over the tiles when here: at once within
//     3 s, faded in after. The tiles are always what shows first. If every
//     tile fails but the picture loads, the overview still shows (it used to
//     give up).
//   * The OSM layout: asked for only while this overview shows with Layout
//     on (no request with Layout off). Ready / "not mapped yet" / "couldn't
//     load" are shown on a small status line; turning Layout off and on
//     retries a failure.

const DETAIL_ID = "naip-detail";
const AREAS_ID = "layout-areas";
const HOLES_ID = "layout-holes";
const kindIs = (kind: string) => ["==", ["get", "kind"], kind] as ["==", ["get", string], string];
// Subtle on purpose: the picture is the star, the lines only help read it.
const LAYOUT_LAYERS: LayerSpecification[] = [
  { id: "layout-green-fill", type: "fill", source: AREAS_ID, filter: kindIs("green"), paint: { "fill-color": "#c8ffb0", "fill-opacity": 0.22 } },
  { id: "layout-fairway", type: "line", source: AREAS_ID, filter: kindIs("fairway"), paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": 1 } },
  { id: "layout-tee", type: "line", source: AREAS_ID, filter: kindIs("tee"), paint: { "line-color": "#ffffff", "line-opacity": 0.6, "line-width": 0.8 } },
  { id: "layout-bunker", type: "line", source: AREAS_ID, filter: kindIs("bunker"), paint: { "line-color": "#fff3cf", "line-opacity": 0.75, "line-width": 0.9 } },
  { id: "layout-water", type: "line", source: AREAS_ID, filter: kindIs("water"), paint: { "line-color": "#a8e1ff", "line-opacity": 0.8, "line-width": 1 } },
  { id: "layout-green", type: "line", source: AREAS_ID, filter: kindIs("green"), paint: { "line-color": "#ffffff", "line-opacity": 0.95, "line-width": 1.5 } },
  { id: "layout-hole", type: "line", source: HOLES_ID, paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1, "line-dasharray": [2, 2] } },
];
const FIRST_LAYOUT_LAYER = LAYOUT_LAYERS[0].id;
const HOLE_LABEL_CLASS =
  "pointer-events-none flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900/70 px-0.5 text-[9px] font-bold leading-none text-white ring-1 ring-white/60";

// How far the camera may wander from the course (degrees, ~2 km).
const BOUNDS_PAD_DEG = 0.02;
// Give up on a map that hasn't drawn by then (bad key, tiles blocked).
const LOAD_TIMEOUT_MS = 12_000;
// ~30 fps is plenty for a slow orbit and halves the GPU work.
const FRAME_MIN_MS = 30;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function cameraFor(lat: number, lng: number, bounds: CourseBounds | null | undefined, el: HTMLElement, sourceMaxZoom: number) {
  const r = el.getBoundingClientRect();
  const f = overviewFraming({ lat, lng }, bounds, r.width || 360, r.height || 225, overviewZoomCap(sourceMaxZoom));
  // The camera may wander a little beyond the course, never far.
  const padLat = Math.max(BOUNDS_PAD_DEG, bounds ? (bounds.north - bounds.south) : 0);
  const padLng = Math.max(BOUNDS_PAD_DEG * 1.5, bounds ? (bounds.east - bounds.west) : 0);
  return {
    center: [f.lng, f.lat] as [number, number],
    // overviewFraming speaks tile (256 px) zoom; MapLibre's is one less.
    zoom: maplibreZoom(f.zoom),
    maxBounds: [
      [f.lng - padLng, f.lat - padLat],
      [f.lng + padLng, f.lat + padLat],
    ] as [[number, number], [number, number]],
  };
}

interface ShownPicture {
  pic: DetailPicture;
  load: DetailLoad;
}

export function CourseOverviewMap({ lat, lng, bounds, name, courseId, useServer, source, onFail }: CourseOverviewMapProps) {
  const { t } = useLocale();
  const boxRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [touched, setTouched] = useState(false);
  const touchedRef = useRef(false);
  // While the camera glides onto our course's own holes, the orbit holds off.
  const easeUntilRef = useRef(0);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const inViewRef = useRef(false);
  const libRef = useRef<{ Marker: typeof import("maplibre-gl").Marker } | null>(null);
  const markersRef = useRef<Marker[]>([]);
  // Remembered per device, so "off" really means no layout request on later
  // course pages too (lib/overviewStatus).
  const [layoutOn, setLayoutOn] = useState(readLayoutPreference);
  const layoutOnRef = useRef(layoutOn);
  layoutOnRef.current = layoutOn;
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [picture, setPicture] = useState<ShownPicture | null>(null);
  // Resolves true once the picture is downloaded (false: none / failed): the
  // map's first draw waits on it when no tile loaded at all.
  const pictureOkRef = useRef<Promise<boolean> | null>(null);

  const boundsKey = bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : "";
  const canLayout = Boolean((useServer && courseId) || validBounds(bounds));

  // The sharp picture: asked for at once (US/USGS only; MapTiler is sharp
  // already), downloaded once, at low priority.
  useEffect(() => {
    if (source.id !== "usgs") {
      pictureOkRef.current = Promise.resolve(false);
      return;
    }
    let cancelled = false;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const chain = coursePicture({ id: courseId, bounds: boundsRef.current }, { useServer, devicePixelRatio: dpr }).then(async (pic) => {
      if (!pic) return false;
      const load = await loadDetailPicture(pic.url);
      if (!cancelled && load.ok && load.objectUrl) setPicture({ pic, load });
      return load.ok;
    });
    pictureOkRef.current = chain;
    return () => {
      cancelled = true;
    };
  }, [source.id, boundsKey, courseId, useServer]);

  // Mount the map only once the box is (nearly) on screen; keep track of
  // visibility for the orbit afterwards.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      inViewRef.current = true;
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        inViewRef.current = visible;
        if (visible) setInView(true);
      },
      { rootMargin: "100px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;
    let map: MaplibreMap | null = null;
    let raf = 0;
    let lastFrame: number | null = null;
    let interacting = false;
    let lastInteractionAt: number | null = null;
    const motion: OverviewMotion = overviewMotion(prefersReducedMotion());
    const fail = () => {
      if (!cancelled) onFailRef.current();
    };
    // First draw: the first `idle` (every tile asked for has loaded or
    // failed). The orbit only starts after it: a camera that moves while the
    // first tiles load keeps changing what's needed and the map never
    // settles. If no tile at all loaded (source down, tiles refused, a course
    // outside the source's coverage), the sharp picture can still carry the
    // view: wait for it a little (pictureRescueWait) before giving up for the
    // still/placeholder view. A few missing tiles are just holes.
    let tilesOk = 0;
    let drawn = false;
    let startOrbit: () => void = () => {};
    const show = () => {
      if (cancelled) return;
      setLoaded(true);
      startOrbit();
    };
    const firstDraw = () => {
      if (drawn || cancelled) return;
      drawn = true;
      window.clearTimeout(timeout);
      // MapLibre stays silent about 404 tiles (sparse sets, e.g. USGS outside
      // its coverage), so "no tile loaded" decides, not an error count.
      if (tilesOk > 0) return show();
      const picOk = pictureOkRef.current;
      if (!picOk) return fail();
      void Promise.race([picOk, new Promise<boolean>((r) => window.setTimeout(() => r(false), pictureRescueWait()))]).then((ok) => (ok ? show() : fail()));
    };
    const timeout = window.setTimeout(firstDraw, LOAD_TIMEOUT_MS);

    const down = () => {
      interacting = true;
      lastInteractionAt = performance.now();
      setTouched(true);
      touchedRef.current = true;
    };
    const up = () => {
      interacting = false;
      lastInteractionAt = performance.now();
    };
    container.addEventListener("pointerdown", down);
    container.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    container.addEventListener("touchend", up, { passive: true });
    container.addEventListener("touchcancel", up, { passive: true });

    void Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")])
      .then(([mod]) => {
        if (cancelled) return;
        const maplibregl = mod.default;
        libRef.current = maplibregl;
        const camera = cameraFor(lat, lng, boundsRef.current, container, source.maxZoom);
        const tileSize = overviewTileSize(source.id, window.devicePixelRatio || 1);
        try {
          map = new maplibregl.Map({
            container,
            style: {
              version: 8,
              sources: {
                satellite: { type: "raster", tiles: [source.template], tileSize, maxzoom: source.maxZoom, attribution: `${source.creditHtml} ${OSM_CREDIT_HTML}` },
              },
              layers: [{ id: "satellite", type: "raster", source: "satellite" }],
            },
            center: camera.center,
            zoom: camera.zoom,
            pitch: OVERVIEW_PITCH,
            bearing: motion === "still" ? STILL_BEARING : 0,
            minZoom: 12.5,
            // Pinching in stops where the imagery would only get blurrier:
            // tile zoom 16.3 on USGS (MapLibre 15.3), 17.5 on MapTiler.
            maxZoom: maplibreZoom(overviewZoomCap(source.maxZoom)),
            maxPitch: 70,
            maxBounds: camera.maxBounds,
            // A page scrolls past this box: the mouse wheel scrolls the page;
            // drag, pinch and two-finger rotate/tilt move the camera.
            scrollZoom: false,
            attributionControl: { compact: false },
            fadeDuration: 0,
          });
        } catch {
          fail();
          return;
        }
        mapRef.current = map;
        map.on("data", (e: { dataType?: string; tile?: { state?: string } }) => {
          // Errored tiles emit `data` too: only count ones that loaded.
          if (e.dataType === "source" && e.tile?.state === "loaded") tilesOk++;
        });
        map.once("idle", firstDraw);
        container.addEventListener("webglcontextlost", fail, { once: true });

        startOrbit = () => {
          if (motion !== "orbit") return;
          let bearing = 0;
          const tick = (ts: number) => {
            raf = requestAnimationFrame(tick);
            const running = orbitRunning({
              motion,
              inView: inViewRef.current,
              pageVisible: document.visibilityState !== "hidden",
              interacting,
              lastInteractionAt,
              now: performance.now(),
            });
            // A glide onto the course's own holes carries the bearing on
            // itself; afterwards the orbit picks up from where it left.
            if (!running || !map || performance.now() < easeUntilRef.current) {
              lastFrame = null;
              return;
            }
            if (lastFrame === null) {
              lastFrame = ts;
              bearing = map.getBearing();
              return;
            }
            if (ts - lastFrame < FRAME_MIN_MS) return;
            bearing = orbitStep(bearing, ts - lastFrame);
            lastFrame = ts;
            map.setBearing(bearing);
          };
          raf = requestAnimationFrame(tick);
        };
      })
      .catch(fail);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("touchstart", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      container.removeEventListener("touchend", up);
      container.removeEventListener("touchcancel", up);
      mapRef.current = null;
      map?.remove();
    };
  }, [inView, lat, lng, source]);

  // The outline can arrive after the map is up (it comes with the photo
  // answer): move the same map there rather than building a new one (a new
  // map would be a second map session).
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !boundsKey) return;
    const camera = cameraFor(lat, lng, boundsRef.current, container, source.maxZoom);
    map.setMaxBounds(camera.maxBounds);
    map.jumpTo({ center: camera.center, zoom: camera.zoom });
  }, [boundsKey, lat, lng, source.maxZoom]);

  // The sharp picture, over the tiles and under the layout, once it's here.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !picture?.load.objectUrl) return;
    const reveal = detailReveal(picture.load.ms);
    if (reveal === "drop") return;
    try {
      map.addSource(DETAIL_ID, { type: "image", url: picture.load.objectUrl, coordinates: picture.pic.coordinates });
      map.addLayer(
        {
          id: DETAIL_ID,
          type: "raster",
          source: DETAIL_ID,
          paint: { "raster-opacity": reveal === "now" ? 1 : 0, "raster-opacity-transition": { duration: 700, delay: 0 }, "raster-fade-duration": 0 },
        },
        map.getLayer(FIRST_LAYOUT_LAYER) ? FIRST_LAYOUT_LAYER : undefined,
      );
      // A late arrival fades in instead of popping mid-orbit.
      if (reveal === "fade") requestAnimationFrame(() => mapRef.current === map && map.getLayer(DETAIL_ID) && map.setPaintProperty(DETAIL_ID, "raster-opacity", 1));
    } catch {
      // Map gone or style not ready: the tiles stay.
    }
    return () => {
      try {
        if (map.getLayer(DETAIL_ID)) map.removeLayer(DETAIL_ID);
        if (map.getSource(DETAIL_ID)) map.removeSource(DETAIL_ID);
      } catch {
        // Already removed with the map.
      }
    };
  }, [loaded, picture]);

  // The OSM layout: only while this overview shows with Layout on. Nothing
  // is asked with Layout off.
  useEffect(() => {
    if (!loaded || !layoutOn || !canLayout) return;
    if (layoutResult && layoutResult.status !== "unavailable") return;
    if (layoutResult?.status === "unavailable" && layoutAttempt === 0) return;
    let cancelled = false;
    setLayoutResult(null);
    void courseLayout({ id: courseId, name, bounds: boundsRef.current }, { useServer, force: layoutAttempt > 0 }).then((r) => {
      if (!cancelled) setLayoutResult(r);
    });
    return () => {
      cancelled = true;
    };
    // layoutResult is read, not a trigger: a new ask only on load/toggle/retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, layoutOn, canLayout, boundsKey, courseId, name, useServer, layoutAttempt]);

  // Draw a ready layout (kept while Layout is off, just hidden).
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!loaded || !map || !lib || layoutResult?.status !== "ready") return;
    const layout = layoutResult.layout;
    const gj = layoutToGeoJSON(layout);
    try {
      map.addSource(AREAS_ID, { type: "geojson", data: gj.areas as GeoJSONSourceSpecification["data"] });
      map.addSource(HOLES_ID, { type: "geojson", data: gj.holes as GeoJSONSourceSpecification["data"] });
      const visibility = layoutOnRef.current ? "visible" : "none";
      for (const layer of LAYOUT_LAYERS) map.addLayer({ ...layer, layout: { visibility } } as LayerSpecification);
      markersRef.current = gj.labels.map((l) => {
        const el = document.createElement("span");
        el.className = HOLE_LABEL_CLASS;
        el.textContent = l.number;
        el.setAttribute("aria-hidden", "true");
        if (!layoutOnRef.current) el.style.display = "none";
        return new lib.Marker({ element: el, anchor: "center" }).setLngLat([l.lng, l.lat]).addTo(map);
      });
      // A multi-course facility (one outline, several courses): glide onto
      // our course's own holes, unless the golfer already took the camera.
      const b = boundsRef.current;
      const own = layoutBounds(layout);
      const container = containerRef.current;
      if (b && own && container && !touchedRef.current && reframeOnLayout(b, own)) {
        const g = { lat: (own.north - own.south) * 0.08, lng: (own.east - own.west) * 0.08 };
        const grown = { south: own.south - g.lat, north: own.north + g.lat, west: own.west - g.lng, east: own.east + g.lng };
        const camera = cameraFor(lat, lng, grown, container, source.maxZoom);
        map.setMaxBounds(camera.maxBounds);
        if (prefersReducedMotion()) {
          map.jumpTo({ center: camera.center, zoom: camera.zoom });
        } else {
          const duration = 1400;
          easeUntilRef.current = performance.now() + duration + 50;
          map.easeTo({ center: camera.center, zoom: camera.zoom, bearing: map.getBearing() + (ORBIT_DEG_PER_SEC * duration) / 1000, duration });
        }
      }
    } catch {
      // Map gone mid-way: nothing to draw on.
    }
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      try {
        for (const layer of LAYOUT_LAYERS) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        if (map.getSource(AREAS_ID)) map.removeSource(AREAS_ID);
        if (map.getSource(HOLES_ID)) map.removeSource(HOLES_ID);
      } catch {
        // Already removed with the map.
      }
    };
  }, [loaded, layoutResult, lat, lng, source.maxZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || layoutResult?.status !== "ready") return;
    try {
      for (const layer of LAYOUT_LAYERS) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", layoutOn ? "visible" : "none");
    } catch {
      // Map gone.
    }
    for (const m of markersRef.current) m.getElement().style.display = layoutOn ? "" : "none";
  }, [layoutOn, layoutResult]);

  const status: LayoutUiStatus = layoutUiStatus({ loaded, canLayout, layoutOn, result: layoutResult });
  const toggleLayout = () => {
    const turningOn = !layoutOn;
    // Turning it back on after a failure asks again (past the short wait).
    if (turningOn && layoutResult?.status === "unavailable") setLayoutAttempt((n) => n + 1);
    setLayoutOn(turningOn);
    writeLayoutPreference(turningOn);
  };
  const statusText: Partial<Record<LayoutUiStatus, string>> = {
    loading: t("courseMedia.layoutLoading"),
    unmapped: t("courseMedia.layoutUnmapped"),
    unavailable: t("courseMedia.layoutUnavailable"),
  };

  return (
    <div ref={boxRef} className="absolute inset-0">
      {/* MapLibre makes its container position: relative, so it sits in a
          wrapper that does the absolute fill. */}
      <div ref={containerRef} role="region" aria-label={t("courseMedia.overviewLabel", { name })} className="h-full w-full" />
      {!loaded && <div className="pointer-events-none absolute inset-0 animate-pulse bg-fairway-50 motion-reduce:animate-none" />}
      {loaded && canLayout && (
        // Outside the map container, so a tap here never counts as touching
        // the map (the orbit keeps going).
        <div className="absolute right-2.5 top-2.5 z-[1] flex flex-col items-end gap-1">
          <button
            type="button"
            aria-pressed={layoutOn}
            data-haptic="tap"
            onClick={toggleLayout}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm transition-colors duration-150 ${
              layoutOn ? "bg-white text-slate-900" : "bg-slate-900/55 text-white/90 hover:text-white"
            }`}
          >
            <Flag size={12} aria-hidden="true" />
            {t("courseMedia.layout")}
          </button>
          <span role="status" aria-live="polite" data-layout-status={status} className={statusText[status] ? "max-w-[210px] rounded-xl bg-slate-900/65 px-2 py-1 text-right text-[10px] font-medium leading-snug text-white backdrop-blur-sm" : "sr-only"}>
            {statusText[status] ?? ""}
          </span>
        </div>
      )}
      {loaded && !touched && (
        // Above the attribution, which can wrap to two lines on a phone.
        <span className="pointer-events-none absolute bottom-14 left-2.5 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {t("courseMedia.dragHint")}
        </span>
      )}
    </div>
  );
}
