// A course's real layout from OpenStreetMap (Micky, 2026-11-06: "the layout
// more visible and authentic"): fairways, greens, bunkers, tees, water and
// the golf=hole lines (tee -> green, ref = hole number), drawn as subtle
// outlines over the drone overview. Pure (no fetch, no DOM), so node tests
// (tests/courseLayout.test.ts) cover it and course-photos can reuse it when
// the layout moves server-side (needs a course_imagery column; see
// DEVELOPMENT_STATUS.md). © OpenStreetMap contributors, ODbL.
import type { CourseBounds } from "./courseBounds.ts";

export type LayoutAreaKind = "fairway" | "green" | "bunker" | "tee" | "water";

export interface LayoutArea {
  kind: LayoutAreaKind;
  /** Closed ring, [lng, lat] pairs (first = last). */
  ring: [number, number][];
}

export interface LayoutHole {
  /** The hole number as shown ("1".."18"), from ref ("7", "Yellow - 7"). */
  number: string;
  par?: number;
  /** Tee -> green, [lng, lat]. */
  line: [number, number][];
}

export interface CourseLayout {
  v: 1;
  areas: LayoutArea[];
  holes: LayoutHole[];
}

/** Overpass element as returned by `out tags geom` (ways and relations). */
export interface OsmLayoutElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat?: number; lon?: number } | null)[];
  members?: { type?: string; role?: string; geometry?: ({ lat?: number; lon?: number } | null)[] }[];
}

const AREA_KIND: Record<string, LayoutAreaKind> = {
  fairway: "fairway",
  green: "green",
  bunker: "bunker",
  tee: "tee",
  water_hazard: "water",
  lateral_water_hazard: "water",
};

// Safety caps: a 36-hole facility has ~1,000 features; anything far past
// that is a mapping mess or the wrong box.
const MAX_AREAS = 1500;
const MAX_HOLES = 120;
const MAX_POINTS_PER_SHAPE = 2000;

/** Overpass QL for the golf features inside a course's outline box (a little
 * padding for tees/greens drawn just past the leisure=golf_course edge). */
export function layoutOverpassQuery(b: CourseBounds, pad = 0.0005): string {
  const box = [b.south - pad, b.west - pad, b.north + pad, b.east + pad].map((v) => v.toFixed(6)).join(",");
  const golf = '"golf"~"^(fairway|green|bunker|tee|water_hazard|lateral_water_hazard|hole)$"';
  return `[out:json][timeout:25];(way[${golf}](${box});relation[${golf}](${box}););out tags geom qt;`;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function toCoords(geom: OsmLayoutElement["geometry"]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of geom ?? []) {
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    out.push([round6(p.lon), round6(p.lat)]);
    if (out.length > MAX_POINTS_PER_SHAPE) return [];
  }
  return out;
}

// ~1 m: under a pixel at any zoom the overview allows (0.3-0.6 m imagery
// seen at <= tile zoom 17.5 is >= ~1 m per CSS px), and it shrinks a
// facility mapped in fine detail a lot (Bethpage Black's own features:
// 171 KB raw).
const SIMPLIFY_DEG = 0.00001;

/** Douglas-Peucker on [lng, lat] (degrees; fine at course scale). Keeps the
 * first and last point, so a closed ring stays closed. */
export function simplifyLine(c: [number, number][], tol = SIMPLIFY_DEG): [number, number][] {
  if (c.length <= 3) return c;
  const keep = new Uint8Array(c.length);
  keep[0] = keep[c.length - 1] = 1;
  const stack: [number, number][] = [[0, c.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist2(c[i], c[s], c[e], 1);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at > 0 && worst > tol2) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  const out = c.filter((_, i) => keep[i]);
  // A ring needs at least 4 points (3 + the closing one); a line 2.
  const closed = c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
  return out.length >= (closed ? 4 : 2) ? out : c;
}

function isClosedRing(c: [number, number][]): boolean {
  if (c.length < 4) return false;
  const [a, z] = [c[0], c[c.length - 1]];
  return a[0] === z[0] && a[1] === z[1];
}

/** "7" -> "7", "Yellow - 7" -> "7", "7a" -> "7a"; null if there's no number. */
export function holeNumber(ref: string | undefined): string | null {
  const m = (ref ?? "").match(/(\d{1,2}[a-z]?)\s*$/i);
  return m ? m[1] : null;
}

/** Does the hole's golf:course:name belong to our course? A facility with
 * several courses (Bethpage: Black, Red, Blue, Green, Yellow) tags each hole
 * with its course; our course name carries the same word. Holes without the
 * tag belong to every course at the facility. */
export function holeBelongsTo(courseName: string, holeCourseName: string | undefined): boolean {
  const h = holeCourseName?.trim().toLowerCase();
  if (!h) return true;
  const words = courseName.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.includes(h) || courseName.toLowerCase().includes(h);
}

// Squared distance in a local, roughly-metric frame (lng scaled by cos lat).
function segDist2(p: [number, number], a: [number, number], b: [number, number], k: number): number {
  const px = p[0] * k, py = p[1];
  const ax = a[0] * k, ay = a[1];
  const bx = b[0] * k, by = b[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0, y = 0;
  const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/** Turn an Overpass answer into the course's layout. With several courses at
 * one facility, only our course's holes are kept, and each area goes to the
 * hole it lies nearest to (kept only when that hole is ours). Null when OSM
 * has nothing usable (no holes and no greens): the overview just shows the
 * imagery. */
export function parseCourseLayout(json: { elements?: OsmLayoutElement[] } | null | undefined, courseName: string): CourseLayout | null {
  const elements = Array.isArray(json?.elements) ? json!.elements! : [];
  const allHoles: (LayoutHole & { ours: boolean })[] = [];
  const areas: LayoutArea[] = [];
  for (const e of elements) {
    const golf = e?.tags?.golf;
    if (!golf) continue;
    if (golf === "hole") {
      if (e.type !== "way") continue;
      const line = simplifyLine(toCoords(e.geometry));
      const number = holeNumber(e.tags?.ref);
      if (line.length < 2 || !number) continue;
      const par = Number(e.tags?.par);
      allHoles.push({ number, line, ...(Number.isFinite(par) && par >= 3 && par <= 6 ? { par } : {}), ours: holeBelongsTo(courseName, e.tags?.["golf:course:name"]) });
      continue;
    }
    const kind = AREA_KIND[golf];
    if (!kind) continue;
    if (e.type === "way") {
      const ring = toCoords(e.geometry);
      if (isClosedRing(ring)) areas.push({ kind, ring: simplifyLine(ring) });
    } else if (e.type === "relation") {
      // Multipolygons: each closed outer member (split outers are skipped).
      for (const m of e.members ?? []) {
        if (m?.role !== "outer") continue;
        const ring = toCoords(m.geometry);
        if (isClosedRing(ring)) areas.push({ kind, ring: simplifyLine(ring) });
      }
    }
  }

  const holes = allHoles.filter((h) => h.ours);
  const multiCourse = holes.length < allHoles.length;
  let kept = areas;
  if (multiCourse && holes.length > 0) {
    const lat0 = allHoles[0].line[0][1];
    const k = Math.cos((lat0 * Math.PI) / 180);
    kept = areas.filter((a) => {
      const c = centroid(a.ring);
      let best = Infinity;
      let bestOurs = false;
      for (const h of allHoles) {
        for (let i = 1; i < h.line.length; i++) {
          const d = segDist2(c, h.line[i - 1], h.line[i], k);
          if (d < best) {
            best = d;
            bestOurs = h.ours;
          }
        }
      }
      return bestOurs;
    });
  } else if (multiCourse) {
    kept = [];
  }

  const outHoles = holes.slice(0, MAX_HOLES).map(({ ours: _ours, ...h }) => h);
  const outAreas = kept.slice(0, MAX_AREAS);
  if (outHoles.length === 0 && !outAreas.some((a) => a.kind === "green")) return null;
  return { v: 1, areas: outAreas, holes: outHoles };
}

/** The box around our course's own features (holes, and areas when there
 * are no holes). Null for an empty layout. */
export function layoutBounds(layout: CourseLayout): CourseBounds | null {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  const add = ([lng, lat]: [number, number]) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  };
  if (layout.holes.length) for (const h of layout.holes) h.line.forEach(add);
  else for (const a of layout.areas) a.ring.forEach(add);
  return Number.isFinite(south) && south < north && west < east ? { south, west, north, east } : null;
}

/** Should the overview re-frame on our course's own holes? Only when they
 * cover clearly less than the outline (a multi-course facility like
 * Bethpage, whose one outline holds five courses), and lie inside it. */
export function reframeOnLayout(outline: CourseBounds, own: CourseBounds | null, maxAreaShare = 0.6): boolean {
  if (!own) return false;
  const area = (b: CourseBounds) => (b.north - b.south) * (b.east - b.west);
  const pad = 0.002;
  const inside = own.south >= outline.south - pad && own.north <= outline.north + pad && own.west >= outline.west - pad && own.east <= outline.east + pad;
  return inside && area(own) < area(outline) * maxAreaShare;
}

// ---- Telling a real answer from a broken one ----
//
// Overpass can answer HTTP 200 and still have failed: a query that ran out
// of time or memory comes back as {"elements": [...partial or none],
// "remark": "runtime error: Query timed out ..."}, and mirrors behind a
// proxy sometimes return an HTML error page with 200. Before 2026-11-07 such
// an answer was parsed like any other, gave "no layout", won the race
// against a slower good answer, cancelled it, and was cached for 30 days.

export type OverpassVerdict =
  | { kind: "ok"; layout: CourseLayout }
  /** A complete, valid answer with nothing usable: the course just isn't
   * mapped in OSM (yet). Worth remembering for a while. */
  | { kind: "unmapped" }
  /** Not a usable answer (error remark, wrong shape, not JSON): try another
   * endpoint / later; never cached as "no layout". */
  | { kind: "invalid"; reason: string };

const ERROR_REMARK = /error|timed out|timeout|out of memory|too many|rate.?limit|dispatcher/i;

export function classifyOverpassAnswer(json: unknown, courseName: string): OverpassVerdict {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { kind: "invalid", reason: "not an object" };
  const j = json as { elements?: unknown; remark?: unknown };
  if (typeof j.remark === "string" && ERROR_REMARK.test(j.remark)) return { kind: "invalid", reason: `remark: ${j.remark.slice(0, 120)}` };
  if (!Array.isArray(j.elements)) return { kind: "invalid", reason: "no elements array" };
  const layout = parseCourseLayout(j as { elements: OsmLayoutElement[] }, courseName);
  return layout ? { kind: "ok", layout } : { kind: "unmapped" };
}

/** What course-photos answers for a course's layout (and the client
 * caches): a layout, or "not mapped". A transient failure is no answer at
 * all (the field is missing), so it is never cached. */
export type LayoutAnswer = { status: "ok"; layout: CourseLayout } | { status: "unmapped" };

/** Several endpoints asked at once: the first "ok" wins at once; "unmapped"
 * only counts once every endpoint has finished (a fast empty answer must
 * not beat a slower real one); all invalid/failed -> null (transient).
 * Never rejects. `onWin` lets the caller cancel the others. */
export async function settleLayoutAttempts(attempts: Promise<OverpassVerdict>[], onWin?: () => void): Promise<LayoutAnswer | null> {
  if (attempts.length === 0) return null;
  return new Promise((resolve) => {
    let left = attempts.length;
    let unmapped = false;
    let done = false;
    const finish = (a: LayoutAnswer | null) => {
      if (done) return;
      done = true;
      onWin?.();
      resolve(a);
    };
    for (const p of attempts) {
      p.then(
        (v) => {
          if (v.kind === "ok") return finish({ status: "ok", layout: v.layout });
          if (v.kind === "unmapped") unmapped = true;
        },
        () => {},
      ).finally(() => {
        left--;
        if (left === 0) finish(unmapped ? { status: "unmapped" } : null);
      });
    }
  });
}

// ---- Asking Overpass: two FOSSGIS servers, one retry ----
//
// Measured 2026-11-07 (Silver Lake, Staten Island, 81 KB answer): 11-50 s
// per answer, plus fast 502 "at capacity" answers. overpass-api.de and
// lz4.overpass-api.de are the same machine (same IP); z.overpass-api.de is
// FOSSGIS's second one (its own 2 slots per IP). Both are the same
// operator and the same usage policy, so no third-party mirror is added.
// (overpass.kumi.systems answered 504 after 41 s, overpass.private.coffee
// nothing in 70 s.)
export const FOSSGIS_OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter"];
/** One ask: Overpass queues before its own 25 s query limit; 50 s answers
 * were seen. */
export const LAYOUT_ATTEMPT_TIMEOUT_MS = 55_000;
/** A retry isn't started with less time than this left. */
export const LAYOUT_RETRY_MIN_MS = 20_000;

export interface LayoutRetryOptions {
  /** Tried in turn from a random start (spreads the load over both). */
  endpoints: string[];
  /** One validated ask (never rejects; HTTP error / non-JSON / error remark
   * / timeout = "invalid"). */
  ask: (endpoint: string, timeoutMs: number) => Promise<OverpassVerdict>;
  /** Total time for both attempts, the pause included. */
  budgetMs: number;
  attemptTimeoutMs?: number;
  /** Before each attempt (the server's daily cap); false = stop. */
  mayAsk?: (attempt: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => number;
}

export interface LayoutRetryResult {
  verdict: OverpassVerdict;
  /** The endpoints actually asked, in order. */
  asked: string[];
}

/** At most two attempts, on different endpoints, with a 0.5-2 s jittered
 * pause between them; only an "invalid" answer is retried. A valid
 * "unmapped" is final (both servers carry the same data). Never rejects. */
export async function askLayoutWithRetry(o: LayoutRetryOptions): Promise<LayoutRetryResult> {
  const clock = o.clock ?? Date.now;
  const random = o.random ?? Math.random;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const perAttempt = o.attemptTimeoutMs ?? LAYOUT_ATTEMPT_TIMEOUT_MS;
  const start = clock();
  const asked: string[] = [];
  const n = o.endpoints.length;
  let verdict: OverpassVerdict = { kind: "invalid", reason: "not asked" };
  if (n === 0) return { verdict, asked };
  const first = Math.min(n - 1, Math.floor(Math.max(0, random()) * n));
  for (let attempt = 0; attempt < Math.min(2, n); attempt++) {
    if (attempt > 0) {
      await sleep(500 + Math.floor(Math.max(0, Math.min(1, random())) * 1500));
    }
    const left = o.budgetMs - (clock() - start);
    if (attempt > 0 && left < LAYOUT_RETRY_MIN_MS) break;
    if (o.mayAsk && !(await o.mayAsk(attempt).catch(() => false))) {
      if (attempt === 0) verdict = { kind: "invalid", reason: "cap" };
      break;
    }
    const endpoint = o.endpoints[(first + attempt) % n];
    asked.push(endpoint);
    try {
      verdict = await o.ask(endpoint, Math.max(1, Math.min(perAttempt, left)));
    } catch {
      verdict = { kind: "invalid", reason: "network/timeout" };
    }
    if (verdict.kind !== "invalid") break;
  }
  return { verdict, asked };
}

/** Is this an answer we may trust from the server or the cache? */
export function isLayoutAnswer(x: unknown): x is LayoutAnswer {
  const a = x as LayoutAnswer;
  if (!a || typeof a !== "object") return false;
  if (a.status === "unmapped") return true;
  return a.status === "ok" && isCourseLayout(a.layout) && (a.layout.holes.length > 0 || a.layout.areas.length > 0);
}

/** Is this a layout we wrote (cache entries from an older build, junk)? */
export function isCourseLayout(x: unknown): x is CourseLayout {
  const l = x as CourseLayout;
  return Boolean(l) && l.v === 1 && Array.isArray(l.areas) && Array.isArray(l.holes);
}

type Feature = { type: "Feature"; properties: Record<string, string | number>; geometry: { type: string; coordinates: unknown } };
export interface LayoutGeoJSON {
  areas: { type: "FeatureCollection"; features: Feature[] };
  holes: { type: "FeatureCollection"; features: Feature[] };
  /** One label per hole, at its tee (the line's first point). */
  labels: { number: string; lng: number; lat: number }[];
}

/** The layout as MapLibre GeoJSON sources (areas carry `kind`, so one
 * source styles every kind) plus the hole-number label points. */
export function layoutToGeoJSON(layout: CourseLayout): LayoutGeoJSON {
  return {
    areas: {
      type: "FeatureCollection",
      features: layout.areas.map((a) => ({ type: "Feature", properties: { kind: a.kind }, geometry: { type: "Polygon", coordinates: [a.ring] } })),
    },
    holes: {
      type: "FeatureCollection",
      features: layout.holes.map((h) => ({ type: "Feature", properties: { number: h.number }, geometry: { type: "LineString", coordinates: h.line } })),
    },
    labels: layout.holes.map((h) => ({ number: h.number, lng: h.line[0][0], lat: h.line[0][1] })),
  };
}
