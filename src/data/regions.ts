import type { GeoPoint } from "../lib/geo";

export interface Region {
  id: string;
  label: string;
  coords: GeoPoint;
  /** True for the one region with real, curated golf-course coverage in
   * this prototype (see lib/courses.ts). Other regions are real, genuine
   * city coordinates — selecting one is not fake, but course recommendations
   * there will correctly come back empty until real course data is added;
   * see lib/courseSearch.ts's no-result handling. Never fabricate course
   * listings for uncovered regions. */
  hasCourseCoverage?: boolean;
}

// A small curated set of real city/region centroids for manual location
// search — not a geocoding API (none is available in this project), but
// genuine public coordinates, not placeholders. Structured as a flat list
// so a real geocoding provider (Google Places, Mapbox, etc.) can replace
// searchRegions()'s implementation later without touching callers.
//
// NYC-area entries (Micky, 2026-11-03: expand location selection): the five
// boroughs and the nearby places NYC golfers commonly play from, so a typed
// "Brooklyn" or "Hoboken" gets real coordinates even offline or in demo
// mode. Public municipal/borough centroids; real accounts also get
// server-side place search (searchRealPlaces) for anything not listed.
export const REGIONS: Region[] = [
  { id: "nyc", label: "New York, NY", coords: { lat: 40.7128, lng: -74.006 }, hasCourseCoverage: true },
  { id: "manhattan", label: "Manhattan, NY", coords: { lat: 40.7831, lng: -73.9712 }, hasCourseCoverage: true },
  { id: "brooklyn", label: "Brooklyn, NY", coords: { lat: 40.6782, lng: -73.9442 }, hasCourseCoverage: true },
  { id: "queens", label: "Queens, NY", coords: { lat: 40.7282, lng: -73.7949 }, hasCourseCoverage: true },
  { id: "bronx", label: "The Bronx, NY", coords: { lat: 40.8448, lng: -73.8648 }, hasCourseCoverage: true },
  { id: "staten-island", label: "Staten Island, NY", coords: { lat: 40.5795, lng: -74.1502 }, hasCourseCoverage: true },
  { id: "jersey-city", label: "Jersey City, NJ", coords: { lat: 40.7178, lng: -74.0431 }, hasCourseCoverage: true },
  { id: "hoboken", label: "Hoboken, NJ", coords: { lat: 40.744, lng: -74.0324 }, hasCourseCoverage: true },
  { id: "newark", label: "Newark, NJ", coords: { lat: 40.7357, lng: -74.1724 } },
  { id: "yonkers", label: "Yonkers, NY", coords: { lat: 40.9312, lng: -73.8988 } },
  { id: "white-plains", label: "White Plains, NY", coords: { lat: 41.034, lng: -73.7629 } },
  { id: "garden-city", label: "Garden City, NY (Nassau County)", coords: { lat: 40.7268, lng: -73.6343 } },
  { id: "farmingdale", label: "Farmingdale, NY", coords: { lat: 40.7326, lng: -73.4454 } },
  { id: "stamford", label: "Stamford, CT", coords: { lat: 41.0534, lng: -73.5387 } },
  { id: "la", label: "Los Angeles, CA", coords: { lat: 34.0522, lng: -118.2437 } },
  { id: "miami", label: "Miami, FL", coords: { lat: 25.7617, lng: -80.1918 } },
  { id: "chicago", label: "Chicago, IL", coords: { lat: 41.8781, lng: -87.6298 } },
  { id: "sf", label: "San Francisco, CA", coords: { lat: 37.7749, lng: -122.4194 } },
  { id: "austin", label: "Austin, TX", coords: { lat: 30.2672, lng: -97.7431 } },
  { id: "boston", label: "Boston, MA", coords: { lat: 42.3601, lng: -71.0589 } },
  { id: "toronto", label: "Toronto, ON", coords: { lat: 43.6532, lng: -79.3832 } },
  { id: "london", label: "London", coords: { lat: 51.5072, lng: -0.1276 } },
  { id: "hongkong", label: "Hong Kong", coords: { lat: 22.3193, lng: 114.1694 } },
  { id: "singapore", label: "Singapore", coords: { lat: 1.3521, lng: 103.8198 } },
  { id: "sydney", label: "Sydney", coords: { lat: -33.8688, lng: 151.2093 } },
];

export function searchRegions(query: string): Region[] {
  const q = query.trim().toLowerCase();
  if (!q) return REGIONS;
  return REGIONS.filter((r) => r.label.toLowerCase().includes(q));
}

export function findRegionByLabel(label: string): Region | undefined {
  return REGIONS.find((r) => r.label.toLowerCase() === label.trim().toLowerCase());
}
