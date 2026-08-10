import type { GeoPoint } from "./geo";

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
