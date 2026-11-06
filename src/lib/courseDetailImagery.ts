// Browser side of the course page's extra detail: the one sharp NAIP picture
// (lib/naipExport) and the OSM layout (_shared/courseLayout). Course pages
// only (the overview and the still view), never lists.
import { NAIP_GIVE_UP_MS } from "./naipExport.ts";
import { isCourseLayout, layoutOverpassQuery, parseCourseLayout, type CourseLayout } from "../../supabase/functions/_shared/courseLayout.ts";
import type { CourseBounds } from "../../supabase/functions/_shared/courseBounds.ts";

// ---- NAIP picture ----

export interface DetailLoad {
  ok: boolean;
  /** How long the load took (ms), from the first ask in this session. */
  ms: number;
}

const pictureLoads = new Map<string, Promise<DetailLoad>>();

/** Load the picture once per session (the overview and the still view share
 * it; the browser's HTTP cache keeps it across sessions for 12 h). CORS
 * mode, so WebGL may use it as a texture. Resolves, never rejects. */
export function loadDetailPicture(url: string, timeoutMs = NAIP_GIVE_UP_MS): Promise<DetailLoad> {
  const known = pictureLoads.get(url);
  if (known) return known;
  const started = performance.now();
  const p = new Promise<DetailLoad>((resolve) => {
    if (typeof Image === "undefined") return resolve({ ok: false, ms: 0 });
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const timer = window.setTimeout(() => done(false), timeoutMs);
    function done(ok: boolean) {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      if (!ok) pictureLoads.delete(url); // a later visit may try again
      resolve({ ok, ms: performance.now() - started });
    }
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  });
  pictureLoads.set(url, p);
  return p;
}

// ---- OSM layout ----

// The two Overpass endpoints course-photos uses. Measured 2026-11-06: 10-35 s
// per answer, and each one sometimes answers 502/504 or not at all; both
// send CORS headers. Plain GET (a "simple" request: no preflight).
export const LAYOUT_OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
// Overpass queues requests before its own 25 s query limit: 26-34 s answers
// were seen, so 50 s before giving up.
const LAYOUT_TIMEOUT_MS = 50_000;
// Per device: a course's layout rarely changes; 30 days, at most 12 courses
// kept (a big facility is ~70 KB).
const CACHE_PREFIX = "golfme:courseLayout:v1:";
const CACHE_INDEX = "golfme:courseLayout:v1:index";
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const CACHE_MAX = 12;

export function layoutCacheKey(courseName: string, b: CourseBounds): string {
  return `${CACHE_PREFIX}${courseName.trim().toLowerCase()}|${[b.south, b.west, b.north, b.east].map((v) => v.toFixed(4)).join(",")}`;
}

interface CachedLayout {
  at: number;
  layout: CourseLayout | null;
}

function readCache(key: string, now: number): CachedLayout | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const c = JSON.parse(raw) as CachedLayout;
    if (!c || typeof c.at !== "number" || now - c.at > CACHE_TTL_MS) return undefined;
    if (c.layout !== null && !isCourseLayout(c.layout)) return undefined;
    return c;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, layout: CourseLayout | null, now: number) {
  try {
    const index: string[] = JSON.parse(localStorage.getItem(CACHE_INDEX) ?? "[]");
    const next = [key, ...index.filter((k) => k !== key)];
    for (const old of next.slice(CACHE_MAX)) localStorage.removeItem(old);
    localStorage.setItem(key, JSON.stringify({ at: now, layout }));
    localStorage.setItem(CACHE_INDEX, JSON.stringify(next.slice(0, CACHE_MAX)));
  } catch {
    // Full or blocked storage: the layout just isn't kept.
  }
}

const layoutLoads = new Map<string, Promise<CourseLayout | null>>();

/** The course's layout: from this device's cache, else Overpass (once per
 * course per session, even on failure). Null = nothing mapped, or Overpass
 * didn't answer (then nothing is cached, so a later session tries again). */
export function fetchCourseLayout(courseName: string, bounds: CourseBounds): Promise<CourseLayout | null> {
  const key = layoutCacheKey(courseName, bounds);
  const known = layoutLoads.get(key);
  if (known) return known;
  const p = (async () => {
    const cached = readCache(key, Date.now());
    if (cached) return cached.layout;
    const q = encodeURIComponent(layoutOverpassQuery(bounds));
    // Both endpoints at once, first good answer wins and the other is
    // cancelled: one of them is often slow or down, and waiting for its
    // timeout before trying the next doubled the wait (measured: 45-57 s
    // sequential vs 10-23 s for the faster one).
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), LAYOUT_TIMEOUT_MS);
    try {
      const layout = await Promise.any(
        LAYOUT_OVERPASS_ENDPOINTS.map(async (endpoint) => {
          const res = await fetch(`${endpoint}?data=${q}`, { signal: ctrl?.signal });
          if (!res.ok) throw new Error(`overpass ${res.status}`);
          return parseCourseLayout(await res.json(), courseName);
        }),
      );
      writeCache(key, layout, Date.now());
      return layout;
    } catch {
      // Every endpoint failed or timed out: nothing cached, retried next session.
      return null;
    } finally {
      clearTimeout(timer);
      ctrl?.abort();
    }
  })();
  layoutLoads.set(key, p);
  return p;
}
