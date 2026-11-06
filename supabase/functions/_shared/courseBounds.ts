// Framing a course, not its pin (Micky, 2026-11-05: "the photos must
// showcase the courses"). Our one point per course (Geoapify) is often the
// clubhouse or the car park, so satellite views centred on it show
// buildings. OpenStreetMap maps most courses as a leisure=golf_course
// outline; its bounding box frames the holes themselves. Pure, so node tests
// (tests/courseBounds.test.ts) and the course-photos Edge Function share it.
import { compareCourseNames, distanceMeters } from "./placesMatch.ts";

export interface CourseBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** An Overpass element from `out bb tags` (ways/relations). */
export interface OsmGolfElement {
  type?: string;
  id?: number;
  bounds?: { minlat?: number; minlon?: number; maxlat?: number; maxlon?: number };
  tags?: Record<string, string>;
}

// A course is at least a few football pitches and at most a big multi-course
// park; anything outside that is a mapping error or the wrong feature.
const MIN_DIAGONAL_M = 150;
const MAX_DIAGONAL_M = 6000;
// Our point may sit just outside the outline (entrance road, car park).
const NEAR_M = 400;

export function validBounds(b: Partial<CourseBounds> | null | undefined): b is CourseBounds {
  if (!b) return false;
  const { south, west, north, east } = b as CourseBounds;
  if (![south, west, north, east].every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  if (south < -85 || north > 85 || west < -180 || east > 180 || south >= north || west >= east) return false;
  const diag = distanceMeters(south, west, north, east);
  return diag >= MIN_DIAGONAL_M && diag <= MAX_DIAGONAL_M;
}

export function boundsCenter(b: CourseBounds): { lat: number; lng: number } {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** Metres from the point to the box (0 inside). */
export function distanceToBounds(lat: number, lng: number, b: CourseBounds): number {
  const clampedLat = Math.min(Math.max(lat, b.south), b.north);
  const clampedLng = Math.min(Math.max(lng, b.west), b.east);
  return distanceMeters(lat, lng, clampedLat, clampedLng);
}

function toBounds(e: OsmGolfElement): CourseBounds | null {
  const b = e.bounds;
  const out = { south: b?.minlat, west: b?.minlon, north: b?.maxlat, east: b?.maxlon } as CourseBounds;
  return validBounds(out) ? out : null;
}

/** The golf-course outline that is this course: within NEAR_M of our
 * point, not a sibling course's (Black vs Red), a named match preferred,
 * then one that contains the point, then the nearest. Null when nothing
 * fits (the caller keeps the point-based framing). */
export function pickCourseOutline(course: { name: string; lat: number; lng: number }, elements: OsmGolfElement[]): CourseBounds | null {
  let best: { b: CourseBounds; named: boolean; inside: boolean; d: number } | null = null;
  for (const e of elements ?? []) {
    if (e?.tags && e.tags.leisure && e.tags.leisure !== "golf_course") continue;
    if (e?.tags?.golf === "driving_range" || /mini|miniature|putt/i.test(e?.tags?.name ?? "")) continue;
    const b = toBounds(e);
    if (!b) continue;
    const d = distanceToBounds(course.lat, course.lng, b);
    if (d > NEAR_M) continue;
    const name = e.tags?.name ? compareCourseNames(course.name, e.tags.name) : "generic";
    if (name === "none") continue;
    const cand = { b, named: name === "named", inside: d === 0, d };
    if (
      !best ||
      (cand.named && !best.named) ||
      (cand.named === best.named && cand.inside && !best.inside) ||
      (cand.named === best.named && cand.inside === best.inside && cand.d < best.d)
    ) {
      best = cand;
    }
  }
  return best?.b ?? null;
}

/** The bounding box of a GeoJSON Polygon / MultiPolygon; null for a point
 * or anything malformed. */
export function boundsFromGeometry(geometry: { type?: string; coordinates?: unknown } | null | undefined): CourseBounds | null {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return null;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  const visit = (c: unknown) => {
    if (Array.isArray(c) && c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
      const [lng, lat] = c as number[];
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        west = Math.min(west, lng);
        east = Math.max(east, lng);
      }
      return;
    }
    if (Array.isArray(c)) c.forEach(visit);
  };
  visit(geometry.coordinates);
  const b = { south, west, north, east };
  return validBounds(b) ? b : null;
}

/** A Geoapify Place Details feature (the course's own OSM object) as an
 * outline, when it has a polygon, names this course and sits by our point. */
export function outlineFromGeoapifyFeature(
  course: { name: string; lat: number; lng: number },
  feature: { properties?: { name?: string; categories?: string[] }; geometry?: { type?: string; coordinates?: unknown } } | null | undefined,
): CourseBounds | null {
  const b = boundsFromGeometry(feature?.geometry);
  if (!b) return null;
  const cats = feature?.properties?.categories;
  if (Array.isArray(cats) && !cats.some((c) => String(c).startsWith("sport.golf") || String(c).startsWith("leisure.park"))) return null;
  const placeName = feature?.properties?.name;
  if (placeName && compareCourseNames(course.name, placeName) === "none") return null;
  return distanceToBounds(course.lat, course.lng, b) <= NEAR_M ? b : null;
}

/** Overpass QL for the golf-course outlines around a point. */
export function overpassQuery(lat: number, lng: number, radiusM = 600): string {
  const p = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `[out:json][timeout:15];(way["leisure"="golf_course"](around:${radiusM},${p});relation["leisure"="golf_course"](around:${radiusM},${p}););out bb tags;`;
}

// ---- Web-Mercator fitting ----

function mercX(lng: number): number {
  return (lng + 180) / 360;
}
function mercY(lat: number): number {
  const r = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

/** The (fractional) zoom at which the box fills a `width` x `height` view,
 * leaving `padding` (fraction of each side) around it, for 256 px tiles. */
export function fitZoom(b: CourseBounds, width: number, height: number, padding = 0.06): number {
  const dx = Math.abs(mercX(b.east) - mercX(b.west));
  const dy = Math.abs(mercY(b.south) - mercY(b.north));
  const w = Math.max(1, width * (1 - 2 * padding));
  const h = Math.max(1, height * (1 - 2 * padding));
  const zx = Math.log2(w / (256 * Math.max(dx, 1e-12)));
  const zy = Math.log2(h / (256 * Math.max(dy, 1e-12)));
  return Math.min(zx, zy);
}

export interface Framing {
  lat: number;
  lng: number;
  zoom: number;
}

// Without an outline the view is centred on our point, a little wider than
// before (the course is usually beside the clubhouse, not under it).
export const POINT_THUMB_ZOOM = 15.2;
export const POINT_HERO_ZOOM = 15;
export const POINT_OVERVIEW_ZOOM = 15.3;

/** Where a still satellite view (thumbnail or hero) looks, and how close. */
export function stillFraming(point: { lat: number; lng: number }, bounds: CourseBounds | null | undefined, width: number, height: number, fallbackZoom: number): Framing {
  if (validBounds(bounds)) {
    const c = boundsCenter(bounds);
    return { ...c, zoom: Math.min(17.5, Math.max(13, fitZoom(bounds, width, height))) };
  }
  return { lat: point.lat, lng: point.lng, zoom: fallbackZoom };
}

// A tilted camera shows more ground behind the centre, so the overview sits
// a little closer than a flat fit.
export const OVERVIEW_TILT_ZOOM = 0.35;

/** The drone overview's orbit centre and zoom, in tile (256 px) zoom like
 * fitZoom; MapLibre's zoom is one less (lib/droneOrbit maplibreZoom).
 * `maxZoom` is the source's cap (lib/droneOrbit overviewZoomCap: USGS
 * 16.3), so a small course is framed as close as the imagery stays sharp,
 * never closer. */
export function overviewFraming(point: { lat: number; lng: number }, bounds: CourseBounds | null | undefined, width: number, height: number, maxZoom = 17.5): Framing {
  const cap = Math.max(13.5, Math.min(17.5, maxZoom));
  if (validBounds(bounds)) {
    const c = boundsCenter(bounds);
    return { ...c, zoom: Math.min(cap, Math.max(13.5, fitZoom(bounds, width, height, 0) + OVERVIEW_TILT_ZOOM)) };
  }
  return { lat: point.lat, lng: point.lng, zoom: Math.min(cap, POINT_OVERVIEW_ZOOM) };
}
