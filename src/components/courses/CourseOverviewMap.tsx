import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useLocale } from "../../i18n/LocaleContext";
import { OSM_CREDIT_HTML, type TileSource } from "../../lib/satelliteTiles";
import { OVERVIEW_PITCH, STILL_BEARING, orbitRunning, orbitStep, overviewMotion, type OverviewMotion } from "../../lib/droneOrbit";
import { overviewFraming, type CourseBounds } from "../../../supabase/functions/_shared/courseBounds.ts";

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
// MapLibre, tilted to pitch 60 and slowly circling the course. Drag or
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

// How far the camera may wander from the course (degrees, ~2 km).
const BOUNDS_PAD_DEG = 0.02;
// Give up on a map that hasn't drawn by then (bad key, tiles blocked).
const LOAD_TIMEOUT_MS = 12_000;
// ~30 fps is plenty for a slow orbit and halves the GPU work.
const FRAME_MIN_MS = 30;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function cameraFor(lat: number, lng: number, bounds: CourseBounds | null | undefined, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const f = overviewFraming({ lat, lng }, bounds, r.width || 360, r.height || 225);
  // The camera may wander a little beyond the course, never far.
  const padLat = Math.max(BOUNDS_PAD_DEG, bounds ? (bounds.north - bounds.south) : 0);
  const padLng = Math.max(BOUNDS_PAD_DEG * 1.5, bounds ? (bounds.east - bounds.west) : 0);
  return {
    center: [f.lng, f.lat] as [number, number],
    zoom: f.zoom,
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
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const inViewRef = useRef(false);

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
        const camera = cameraFor(lat, lng, boundsRef.current, container);
        try {
          map = new maplibregl.Map({
            container,
            style: {
              version: 8,
              sources: {
                satellite: { type: "raster", tiles: [source.template], tileSize: 256, maxzoom: source.maxZoom, attribution: `${source.creditHtml} ${OSM_CREDIT_HTML}` },
              },
              layers: [{ id: "satellite", type: "raster", source: "satellite" }],
            },
            center: camera.center,
            zoom: camera.zoom,
            pitch: OVERVIEW_PITCH,
            bearing: motion === "still" ? STILL_BEARING : 0,
            minZoom: 13.5,
            maxZoom: 18.5,
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
            if (!running || !map) {
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
  const boundsKey = bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : "";
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !boundsKey) return;
    const camera = cameraFor(lat, lng, boundsRef.current, container);
    map.setMaxBounds(camera.maxBounds);
    map.jumpTo({ center: camera.center, zoom: camera.zoom });
  }, [boundsKey, lat, lng]);

  return (
    <div ref={boxRef} className="absolute inset-0">
      {/* MapLibre makes its container position: relative, so it sits in a
          wrapper that does the absolute fill. */}
      <div ref={containerRef} role="region" aria-label={t("courseMedia.overviewLabel", { name })} className="h-full w-full" />
      {!loaded && <div className="pointer-events-none absolute inset-0 animate-pulse bg-fairway-50 motion-reduce:animate-none" />}
      {loaded && !touched && (
        // Above the attribution, which can wrap to two lines on a phone.
        <span className="pointer-events-none absolute bottom-14 left-2.5 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {t("courseMedia.dragHint")}
        </span>
      )}
    </div>
  );
}
