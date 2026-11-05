import type { GeoPoint } from "./geo";
import type { CourseBounds } from "../../supabase/functions/_shared/courseBounds.ts";

// Canonical course list for the prototype — every course referenced across
// mock golfers and Golf Calls, plus a couple extra for a richer search.
// Swap for a real course-data API later without touching callers.
export const COURSES: string[] = [
  "Bethpage Black",
  "Bethpage Blue",
  "Bethpage Red",
  "Cantiague Park Golf Course",
  "Cherry Valley Club",
  "Eisenhower Park Red",
  "Eisenhower Park White",
  "Forest Park Golf Course",
  "Harbor Links Golf Course",
  "Liberty National",
  "Salisbury Red Course",
  "Split Rock Golf Course",
  "Van Cortlandt Park Golf Course",
].sort();

// Display-only area label per course, for contexts (like a Community course
// tag) that want to show "Course · Area" without a real course-data table.
// Not a second course record — COURSES above is still the only source of
// truth for which courses exist.
const COURSE_AREAS: Record<string, string> = {
  "Bethpage Black": "Farmingdale, NY",
  "Bethpage Blue": "Farmingdale, NY",
  "Bethpage Red": "Farmingdale, NY",
  "Cantiague Park Golf Course": "Hicksville, NY",
  "Cherry Valley Club": "Garden City, NY",
  "Eisenhower Park Red": "East Meadow, NY",
  "Eisenhower Park White": "East Meadow, NY",
  "Forest Park Golf Course": "Queens, NY",
  "Harbor Links Golf Course": "Port Washington, NY",
  "Liberty National": "Jersey City, NJ",
  "Salisbury Red Course": "East Meadow, NY",
  "Split Rock Golf Course": "Bronx, NY",
  "Van Cortlandt Park Golf Course": "Bronx, NY",
};

export function areaForCourse(course: string): string | undefined {
  return COURSE_AREAS[course];
}

// Real, approximate public coordinates (course/park-level, not exact tee
// coordinates) for every course above — this is the one region in the app
// with genuine location-aware course data. Powers real haversine distance
// in lib/courseSearch.ts rather than the hardcoded mock distanceMiles
// numbers baked into seed Golf Calls/profiles.
const COURSE_COORDS: Record<string, GeoPoint> = {
  "Bethpage Black": { lat: 40.7404, lng: -73.4592 },
  "Bethpage Blue": { lat: 40.7404, lng: -73.4592 },
  "Bethpage Red": { lat: 40.7404, lng: -73.4592 },
  "Cantiague Park Golf Course": { lat: 40.7648, lng: -73.5309 },
  "Cherry Valley Club": { lat: 40.7268, lng: -73.6343 },
  "Eisenhower Park Red": { lat: 40.7204, lng: -73.562 },
  "Eisenhower Park White": { lat: 40.7204, lng: -73.562 },
  "Forest Park Golf Course": { lat: 40.7005, lng: -73.8459 },
  "Harbor Links Golf Course": { lat: 40.829, lng: -73.6976 },
  "Liberty National": { lat: 40.7009, lng: -74.0479 },
  "Salisbury Red Course": { lat: 40.7284, lng: -73.5622 },
  "Split Rock Golf Course": { lat: 40.8636, lng: -73.806 },
  "Van Cortlandt Park Golf Course": { lat: 40.8983, lng: -73.8916 },
};

export function coordsForCourse(course: string): GeoPoint | undefined {
  return COURSE_COORDS[course];
}

// Each course's OpenStreetMap leisure=golf_course outline (bounding box),
// fetched once from the public Overpass API on 2026-11-05 and picked by name
// (© OpenStreetMap contributors, ODbL), so demo satellite views frame the
// holes like real courses do (real ones get theirs from course-photos).
// Several COURSE_COORDS points above sit ~1 km from their course (Forest
// Park, Split Rock, Cantiague, Cherry Valley); the outline is what fixes the
// framing. A facility's single outline serves each of its courses (the same
// rule course-photos applies). null: no outline found near enough (the view
// stays centred on the point, a little wide).
const COURSE_BOUNDS: Record<string, CourseBounds | null> = {
  "Bethpage Black": { south: 40.7354678, west: -73.4725884, north: 40.7571359, east: -73.4346576 },
  "Bethpage Blue": { south: 40.7354678, west: -73.4725884, north: 40.7571359, east: -73.4346576 },
  "Bethpage Red": { south: 40.7354678, west: -73.4725884, north: 40.7571359, east: -73.4346576 },
  "Cantiague Park Golf Course": { south: 40.7669808, west: -73.5459894, north: 40.7728374, east: -73.5417602 },
  "Cherry Valley Club": { south: 40.7125902, west: -73.652543, north: 40.7227688, east: -73.6440762 },
  "Eisenhower Park Red": { south: 40.728858, west: -73.58743, north: 40.7493455, east: -73.5534832 },
  "Eisenhower Park White": { south: 40.728858, west: -73.58743, north: 40.7493455, east: -73.5534832 },
  "Forest Park Golf Course": { south: 40.6969132, west: -73.8688458, north: 40.7026627, east: -73.8589546 },
  "Harbor Links Golf Course": null,
  "Liberty National": null,
  "Salisbury Red Course": null,
  "Split Rock Golf Course": { south: 40.8736013, west: -73.8156478, north: 40.8865624, east: -73.7965827 },
  "Van Cortlandt Park Golf Course": { south: 40.8903751, west: -73.8914454, north: 40.906012, east: -73.8836547 },
};

export function boundsForCourse(course: string): CourseBounds | null {
  return COURSE_BOUNDS[course] ?? null;
}
