import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSourceSpecification, LayerSpecification, Map as MaplibreMap, Marker } from "maplibre-gl";
import { Flag } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { detailReveal, naipExportFor } from "../../lib/naipExport";
import { fetchCourseLayout, loadDetailPicture } from "../../lib/courseDetailImagery";
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

interface CourseOverviewMapProps {
  lat: number;
  lng: number;
  /** The course's OSM outline: the orbit circles its centre, framed to fit.
   * Without it, our point, a little wide. */
  bounds?: CourseBounds | null;
  name: string;
  /** Aerial tiles: USGS NAIP (US, no key, to z16; MapLibre scales them up
   * closer in) or MapTiler when keyed. */
  source: TileSource;
  /** The live map can't run (style/tiles refused, WebGL lost): the parent
   * switches to the still satellite view. */
  onFail: () => void;
}

// The "drone shot" (Micky, 2026-11-05): aerial imagery (USGS NAIP for US
// courses, MapTiler when keyed) in
// MapLibre, tilted to pitch 45 (was 60 until 2026-11-06) and slowly
// circling the course. The camera never goes more than 0.3 zoom past the
// source's deepest tiles (USGS: 16) and retina screens get USGS tiles at
// native density (lib/droneOrbit overviewZoomCap / overviewTileSize). Drag or
// pinch to look around; that pauses the circling, which carries on from
// there after a few seconds. Reduced motion: the same tilted view, still.
// It is the real satellite picture, only the camera moves. It circles the
// centre of the course's OpenStreetMap outline, zoomed to fit it, so the
// holes fill the view rather than the clubhouse our single point is often
// on; without an outline it circles that point, a little wider.
//
// Cost: MapLibre (~800 KB) downloads only when a course page opens (it's
// already in the course map's chunk); the map is created only once the box
// is on screen and removed on leave; the camera stops while it's off screen
// or the app is in the background. Raster tiles only, no vector style.
//
// Detail (Micky, 2026-11-06: "even more detailed... the layout more visible
// and authentic"), courses with an outline only:
//   * USGS (US, no MapTiler key): one sharp NAIP picture of the outline box
//     (lib/naipExport), laid over
//     the z16 tiles as an image source once it has loaded: at once within
//     3 s, faded in after (a cold render takes 10-45 s; repeats are cached);
//     never arrives -> the tiles are what shows.
//   * the course's OSM layout (_shared/courseLayout via
//     lib/courseDetailImagery): fairway/tee/bunker/water outlines, greens
//     lit, dashed hole lines and hole numbers at the tees. "Layout" toggles
//     it (default on). Static GeoJSON + 18 DOM markers: the orbit only moves
//     the camera, so it stays as smooth as before.

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

export function CourseOverviewMap({ lat, lng, bounds, name, source, onFail }: CourseOverviewMapProps) {
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
  const [hasLayout, setHasLayout] = useState(false);
  const [layoutOn, setLayoutOn] = useState(true);
  const layoutOnRef = useRef(layoutOn);
  layoutOnRef.current = layoutOn;

  // The sharp picture is asked for as soon as the page knows the outline, in
  // parallel with the tiles (US/USGS only; MapTiler is sharp already).
  const boundsKey = bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : "";
  const detail = useMemo(
    () => (source.id === "usgs" && validBounds(bounds) ? naipExportFor(bounds, { devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1 }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey is bounds' identity
    [source.id, boundsKey],
  );
  useEffect(() => {
    if (detail) void loadDetailPicture(detail.url);
  }, [detail]);

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
    // outside the source's coverage) the view gives up for the still/
    // placeholder one; a few missing tiles are just holes.
    let tilesOk = 0;
    let drawn = false;
    let startOrbit: () => void = () => {};
    const firstDraw = () => {
      if (drawn || cancelled) return;
      drawn = true;
      window.clearTimeout(timeout);
      // Nothing to show at all: MapLibre stays silent about 404 tiles (sparse
      // sets, e.g. USGS outside its coverage), so "no tile loaded" decides,
      // not an error count.
      if (tilesOk === 0) {
        fail();
        return;
      }
      setLoaded(true);
      startOrbit();
    };
    const timeout = window.setTimeout(() => {
      // Slow network: show what's there if anything loaded, else give up.
      if (tilesOk > 0) firstDraw();
      else fail();
    }, LOAD_TIMEOUT_MS);

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
    if (!loaded || !map || !detail) return;
    let cancelled = false;
    void loadDetailPicture(detail.url).then(({ ok, ms }) => {
      if (cancelled || !ok || mapRef.current !== map) return;
      const reveal = detailReveal(ms);
      if (reveal === "drop") return;
      try {
        map.addSource(DETAIL_ID, { type: "image", url: detail.url, coordinates: detail.coordinates });
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
    });
    return () => {
      cancelled = true;
      try {
        if (map.getLayer(DETAIL_ID)) map.removeLayer(DETAIL_ID);
        if (map.getSource(DETAIL_ID)) map.removeSource(DETAIL_ID);
      } catch {
        // Already removed with the map.
      }
    };
  }, [loaded, detail]);

  // The OSM layout (fetched once per course per device, see
  // lib/courseDetailImagery), drawn over the picture.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    const b = boundsRef.current;
    // Any imagery source: the layout is OSM data, not USGS.
    if (!loaded || !map || !lib || !validBounds(b)) return;
    let cancelled = false;
    void fetchCourseLayout(name, b).then((layout) => {
      if (cancelled || !layout || mapRef.current !== map) return;
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
        setHasLayout(true);
        // A multi-course facility (one outline, several courses): glide onto
        // our course's own holes, unless the golfer already took the camera.
        const own = layoutBounds(layout);
        const container = containerRef.current;
        if (own && container && !touchedRef.current && reframeOnLayout(b, own)) {
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
    });
    return () => {
      cancelled = true;
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
  }, [loaded, boundsKey, name, lat, lng, source.maxZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasLayout) return;
    try {
      for (const layer of LAYOUT_LAYERS) if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", layoutOn ? "visible" : "none");
    } catch {
      // Map gone.
    }
    for (const m of markersRef.current) m.getElement().style.display = layoutOn ? "" : "none";
  }, [layoutOn, hasLayout]);

  return (
    <div ref={boxRef} className="absolute inset-0">
      {/* MapLibre makes its container position: relative, so it sits in a
          wrapper that does the absolute fill. */}
      <div ref={containerRef} role="region" aria-label={t("courseMedia.overviewLabel", { name })} className="h-full w-full" />
      {!loaded && <div className="pointer-events-none absolute inset-0 animate-pulse bg-fairway-50 motion-reduce:animate-none" />}
      {hasLayout && (
        // Outside the map container, so a tap here never counts as touching
        // the map (the orbit keeps going).
        <button
          type="button"
          aria-pressed={layoutOn}
          data-haptic="tap"
          onClick={() => setLayoutOn((v) => !v)}
          className={`absolute right-2.5 top-2.5 z-[1] inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm transition-colors duration-150 ${
            layoutOn ? "bg-white text-slate-900" : "bg-slate-900/55 text-white/90 hover:text-white"
          }`}
        >
          <Flag size={12} aria-hidden="true" />
          {t("courseMedia.layout")}
        </button>
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
