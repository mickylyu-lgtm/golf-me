import { courseImageryThrottle } from "./courseImageryThrottle.ts";
// Browser side of the course page's extra detail: the one sharp NAIP picture
// (lib/naipExport) and the OSM layout (_shared/courseLayout). Course pages
// only (the overview and the still view), never lists.
//
// Where they come from (2026-11-07):
//   * Real accounts (a public.courses id): course-photos makes each once per
//     course and stores it (20261107190000): a warm Storage URL for the
//     picture, the stored layout. The browser never asks Overpass or the
//     NAIP ImageServer for them.
//   * Demo courses (no id), or while course-photos doesn't know these
//     requests yet (an older deployment answers without `pictures` /
//     `layouts`): the browser asks USGS / Overpass directly: FOSSGIS's own
//     servers only (overpass-api.de, z.overpass-api.de; maps.mail.ru is
//     gone: it saw each viewer's IP).
//   * A cold layout can take 20-110 s on the server: course-photos answers
//     "pending" after 20 s and keeps looking; the page asks again every 8 s
//     (up to 2.5 min) and keeps saying "Loading the course layout…".
// Nothing is asked until it's needed: the picture when the course page's
// media shows, the layout only while the overview shows with Layout on.
import { NAIP_GIVE_UP_MS, cornersOf, naipExportFor, validMercBox, type Corners, type MercBox } from "./naipExport.ts";
import {
  FOSSGIS_OVERPASS_ENDPOINTS,
  askLayoutWithRetry,
  classifyOverpassAnswer,
  isLayoutAnswer,
  layoutOverpassQuery,
  type CourseLayout,
  type LayoutAnswer,
  type OverpassVerdict,
} from "../../supabase/functions/_shared/courseLayout.ts";
import type { CourseBounds } from "../../supabase/functions/_shared/courseBounds.ts";
import type { CoursePhotosResponse } from "../../supabase/functions/_shared/coursePhotoTypes.ts";

// ---- course-photos, injectable (node tests pass a stub) ----

export type DetailServer = (body: Record<string, unknown>) => Promise<CoursePhotosResponse | null>;

let server: DetailServer | null = null;

/** Tests (and nothing else) replace the server call. */
export function setDetailServer(fn: DetailServer | null) {
  server = fn;
}

class ImageryBudgetPause extends Error {}

async function callServer(body: Record<string, unknown>): Promise<CoursePhotosResponse | null> {
  if (courseImageryThrottle.active()) throw new ImageryBudgetPause("course imagery budget paused");
  const budgetScope = courseImageryThrottle.scope();
  try {
    if (server) return await server(body);
    const { supabase } = await import("./supabase");
    courseImageryThrottle.bindAuth(supabase.auth);
    const { data, error } = await supabase.functions.invoke("course-photos", { body });
    if (error) throw error;
    return (data ?? null) as CoursePhotosResponse | null;
  } catch (error) {
    if (await courseImageryThrottle.record(error, Date.now(), budgetScope)) throw new ImageryBudgetPause("course imagery budget paused");
    throw error;
  }
}

// ---- NAIP picture ----

export interface DetailPicture {
  /** Where to load it from: a Storage URL (warm) or the USGS export. */
  url: string;
  bbox: MercBox;
  coordinates: Corners;
  width: number;
  height: number;
  from: "storage" | "usgs";
}

export interface DetailLoad {
  ok: boolean;
  /** How long the load took (ms), from the first ask in this session. */
  ms: number;
  /** A blob: URL of the downloaded picture, shared by every user of it (one
   * download; MapLibre and the still view both read the same bytes). */
  objectUrl?: string;
}

const pictureLoads = new Map<string, Promise<DetailLoad>>();

/** Download the picture once per session and hand out one blob: URL for it.
 * (Before 2026-11-07 an Image preload and MapLibre's own fetch each
 * downloaded it: two 0.15-0.7 MB requests per view.) Low fetch priority, so
 * it never holds up the map's tiles. Resolves, never rejects; a failure is
 * forgotten, so a later visit tries again. */
export function loadDetailPicture(url: string, timeoutMs = NAIP_GIVE_UP_MS): Promise<DetailLoad> {
  const known = pictureLoads.get(url);
  if (known) return known;
  const started = performance.now();
  const p = (async (): Promise<DetailLoad> => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl?.signal, priority: "low" } as RequestInit);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type || "image/jpeg") || blob.size < 1000) throw new Error("not a picture");
      return { ok: true, ms: performance.now() - started, objectUrl: URL.createObjectURL(blob) };
    } catch {
      pictureLoads.delete(url);
      return { ok: false, ms: performance.now() - started };
    } finally {
      clearTimeout(timer);
    }
  })();
  pictureLoads.set(url, p);
  return p;
}

const pictureAsks = new Map<string, Promise<DetailPicture | null>>();

function directPicture(bounds: CourseBounds | null | undefined, dpr: number): DetailPicture | null {
  const e = naipExportFor(bounds, { devicePixelRatio: dpr });
  return e ? { url: e.url, bbox: e.bbox, coordinates: e.coordinates, width: e.width, height: e.height, from: "usgs" } : null;
}

/** Which picture to show for this course (not the bytes; see
 * loadDetailPicture). Null = none (the tiles stay). Asked once per course
 * per session; a failed server ask isn't remembered. */
export function coursePicture(course: { id?: string; bounds?: CourseBounds | null }, opts: { useServer: boolean; devicePixelRatio: number }): Promise<DetailPicture | null> {
  const key = opts.useServer && course.id ? `id:${course.id}` : `box:${JSON.stringify(course.bounds ?? null)}:${opts.devicePixelRatio >= 2 ? 2 : 1}`;
  const known = pictureAsks.get(key);
  if (known) return known;
  const p = (async () => {
    if (opts.useServer && course.id) {
      try {
        const res = await callServer({ courseIds: [course.id], picture: true });
        if (res && res.pictures && typeof res.pictures === "object") {
          const pic = res.pictures[course.id];
          if (pic && typeof pic.url === "string" && /^https:\/\//.test(pic.url) && validMercBox(pic.bbox)) {
            return { url: pic.url, bbox: pic.bbox as MercBox, coordinates: cornersOf(pic.bbox as MercBox), width: pic.width, height: pic.height, from: "storage" as const };
          }
          // The server answered "none" (not US, no outline, render failed):
          // the tiles stay; no direct render behind its back.
          return null;
        }
        // An older course-photos without `pictures`: the browser's own render.
      } catch (error) {
        pictureAsks.delete(key);
        if (error instanceof ImageryBudgetPause) return null;
        // course-photos not deployed / down: the browser's own render.
      }
    }
    return directPicture(course.bounds, opts.devicePixelRatio);
  })();
  pictureAsks.set(key, p);
  return p;
}

// ---- OSM layout ----

/** Direct (demo / fallback) endpoints: FOSSGIS's two servers only
 * (overpass-api.de, z.overpass-api.de), one retry on the other. */
export const LAYOUT_OVERPASS_ENDPOINTS = FOSSGIS_OVERPASS_ENDPOINTS;
// Overpass queues requests before its own 25 s query limit: 11-50 s
// answers were seen (2026-11-07), so up to 55 s per ask and 100 s for both.
const LAYOUT_TIMEOUT_MS = 100_000;
// A cold server lookup can take 20-110 s (course-photos answers "pending"
// after 20 s and keeps going): ask again every 8 s, for up to 2.5 minutes,
// while the page says "Loading the course layout…".
export const LAYOUT_POLL_MS = 8_000;
export const LAYOUT_POLL_BUDGET_MS = 150_000;
// Per device. A layout: 30 days. A course with nothing mapped: 7 days (OSM
// volunteers keep mapping). A failure: not stored; this session waits a
// couple of minutes before asking again, unless the golfer asks (Layout
// off and on).
export const LAYOUT_OK_TTL_MS = 30 * 24 * 3600 * 1000;
export const LAYOUT_UNMAPPED_TTL_MS = 7 * 24 * 3600 * 1000;
export const LAYOUT_RETRY_MS = 2 * 60 * 1000;
const CACHE_PREFIX = "golfme:courseLayout:v2:";
const CACHE_INDEX = "golfme:courseLayout:v2:index";
// v1 (116c441) could store a broken answer as "no layout" for 30 days.
const OLD_PREFIX = "golfme:courseLayout:v1:";
const CACHE_MAX = 12;

export type LayoutResult = { status: "ready"; layout: CourseLayout } | { status: "unmapped" } | { status: "unavailable" };

export function layoutCacheKey(course: { id?: string; name: string; bounds?: CourseBounds | null }): string {
  if (course.id) return `${CACHE_PREFIX}id:${course.id}`;
  const b = course.bounds;
  return `${CACHE_PREFIX}${course.name.trim().toLowerCase()}|${b ? [b.south, b.west, b.north, b.east].map((v) => v.toFixed(4)).join(",") : "-"}`;
}

interface CachedLayout {
  at: number;
  answer: LayoutAnswer;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

let oldCleared = false;
function clearOldCache(s: Storage) {
  if (oldCleared) return;
  oldCleared = true;
  try {
    const old: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(OLD_PREFIX)) old.push(k);
    }
    old.forEach((k) => s.removeItem(k));
  } catch {
    // Nothing to do.
  }
}

export function readLayoutCache(key: string, now: number): LayoutAnswer | undefined {
  const s = storage();
  if (!s) return undefined;
  clearOldCache(s);
  try {
    const raw = s.getItem(key);
    if (!raw) return undefined;
    const c = JSON.parse(raw) as CachedLayout;
    if (!c || typeof c.at !== "number" || !isLayoutAnswer(c.answer)) return undefined;
    const ttl = c.answer.status === "ok" ? LAYOUT_OK_TTL_MS : LAYOUT_UNMAPPED_TTL_MS;
    return now - c.at <= ttl && now >= c.at ? c.answer : undefined;
  } catch {
    return undefined;
  }
}

export function writeLayoutCache(key: string, answer: LayoutAnswer, now: number) {
  const s = storage();
  if (!s) return;
  try {
    const index: string[] = JSON.parse(s.getItem(CACHE_INDEX) ?? "[]");
    const next = [key, ...index.filter((k) => k !== key)];
    for (const old of next.slice(CACHE_MAX)) s.removeItem(old);
    s.setItem(key, JSON.stringify({ at: now, answer }));
    s.setItem(CACHE_INDEX, JSON.stringify(next.slice(0, CACHE_MAX)));
  } catch {
    // Full or blocked storage: the layout just isn't kept.
  }
}

/** One endpoint, validated: an HTTP error, a non-JSON body or an error
 * remark is "invalid", never "unmapped". */
async function askOverpass(endpoint: string, name: string, bounds: CourseBounds, timeoutMs: number): Promise<OverpassVerdict> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}?data=${encodeURIComponent(layoutOverpassQuery(bounds))}`, { signal: ctrl?.signal });
    if (!res.ok) return { kind: "invalid", reason: `http ${res.status}` };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: "invalid", reason: "not json" };
    }
    return classifyOverpassAnswer(json, name);
  } catch {
    return { kind: "invalid", reason: "network/timeout" };
  } finally {
    clearTimeout(timer);
  }
}

/** Demo / fallback: one ask, and one retry on FOSSGIS's other server. */
async function directLayout(name: string, bounds: CourseBounds, timeoutMs = LAYOUT_TIMEOUT_MS, sleep?: (ms: number) => Promise<void>): Promise<LayoutAnswer | null> {
  const { verdict } = await askLayoutWithRetry({
    endpoints: LAYOUT_OVERPASS_ENDPOINTS,
    ask: (endpoint, t) => askOverpass(endpoint, name, bounds, t),
    budgetMs: timeoutMs,
    sleep,
  });
  if (verdict.kind === "ok") return { status: "ok", layout: verdict.layout };
  return verdict.kind === "unmapped" ? { status: "unmapped" } : null;
}

type ServerLayout = { kind: "answer"; answer: LayoutAnswer | null } | { kind: "old" };

/** course-photos' layout, asking again while it says "pending" (a cold
 * lookup carries on server-side). "old" = a course-photos that doesn't
 * know layouts (or none reachable): the caller asks directly. */
async function serverLayout(id: string, pollMs: number, budgetMs: number): Promise<ServerLayout> {
  const started = Date.now();
  for (let ask = 0; ; ask++) {
    let res: CoursePhotosResponse | null;
    try {
      res = await callServer({ courseIds: [id], layout: true });
    } catch (error) {
      // Down / not deployed: direct, unless an earlier ask already reached
      // a server that knows layouts (then a hiccup just ends this wait).
      if (error instanceof ImageryBudgetPause) return { kind: "answer", answer: null };
      return ask === 0 ? { kind: "old" } : { kind: "answer", answer: null };
    }
    if (!res || !res.layouts || typeof res.layouts !== "object") return ask === 0 ? { kind: "old" } : { kind: "answer", answer: null };
    const a = res.layouts[id];
    if (isLayoutAnswer(a)) return { kind: "answer", answer: a };
    const pending = Array.isArray(res.layoutsPending) && res.layoutsPending.includes(id);
    if (!pending || Date.now() - started + pollMs > budgetMs) return { kind: "answer", answer: null };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

const layoutAsks = new Map<string, Promise<LayoutResult>>();
const layoutFailedAt = new Map<string, number>();

/** The course's layout for the overview. `force` (the golfer turned Layout
 * back on) skips the short wait after a failure. Resolves, never rejects. */
export function courseLayout(
  course: { id?: string; name: string; bounds?: CourseBounds | null },
  // timeoutMs / pollMs / pollBudgetMs / sleep: tests only.
  opts: { useServer: boolean; force?: boolean; timeoutMs?: number; pollMs?: number; pollBudgetMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<LayoutResult> {
  const key = layoutCacheKey(course);
  const known = layoutAsks.get(key);
  if (known) return known;
  const cached = readLayoutCache(key, Date.now());
  if (cached) return Promise.resolve(toResult(cached));
  const failedAt = layoutFailedAt.get(key);
  if (!opts.force && failedAt != null && Date.now() - failedAt < LAYOUT_RETRY_MS) return Promise.resolve({ status: "unavailable" });
  const p = (async (): Promise<LayoutResult> => {
    let answer: LayoutAnswer | null = null;
    let viaServer = false;
    if (opts.useServer && course.id) {
      const s = await serverLayout(course.id, opts.pollMs ?? LAYOUT_POLL_MS, opts.pollBudgetMs ?? LAYOUT_POLL_BUDGET_MS);
      if (s.kind === "answer") {
        viaServer = true;
        answer = s.answer;
      }
    }
    if (!viaServer && !answer && course.bounds) answer = await directLayout(course.name, course.bounds, opts.timeoutMs, opts.sleep);
    if (answer) {
      writeLayoutCache(key, answer, Date.now());
      layoutFailedAt.delete(key);
      return toResult(answer);
    }
    if (!courseImageryThrottle.active()) layoutFailedAt.set(key, Date.now());
    return { status: "unavailable" };
  })();
  layoutAsks.set(key, p);
  // A failure isn't kept in this map either: the next ask (after the wait,
  // or forced) goes out again.
  void p.then((r) => {
    if (r.status === "unavailable") layoutAsks.delete(key);
  });
  return p;
}

function toResult(a: LayoutAnswer): LayoutResult {
  return a.status === "ok" ? { status: "ready", layout: a.layout } : { status: "unmapped" };
}
