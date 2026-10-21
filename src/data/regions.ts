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
  /** ISO 3166-1 alpha-2, lowercase (same format Geoapify returns). */
  countryCode: string;
  /** IANA time zone of the city. */
  timezone: string;
}

// A small curated set of real city/region centroids. Since global hosting
// Phase 2, real accounts search cities worldwide through the course-search
// Edge Function's geocode mode (src/lib/cityGeocode.ts); this list stays as
// the instant, offline and demo-mode fallback, and is shown first when it
// matches. Genuine public coordinates, not placeholders.
export const REGIONS: Region[] = [
  { id: "nyc", label: "New York, NY", coords: { lat: 40.7128, lng: -74.006 }, hasCourseCoverage: true, countryCode: "us", timezone: "America/New_York" },
  { id: "la", label: "Los Angeles, CA", coords: { lat: 34.0522, lng: -118.2437 }, countryCode: "us", timezone: "America/Los_Angeles" },
  { id: "miami", label: "Miami, FL", coords: { lat: 25.7617, lng: -80.1918 }, countryCode: "us", timezone: "America/New_York" },
  { id: "chicago", label: "Chicago, IL", coords: { lat: 41.8781, lng: -87.6298 }, countryCode: "us", timezone: "America/Chicago" },
  { id: "sf", label: "San Francisco, CA", coords: { lat: 37.7749, lng: -122.4194 }, countryCode: "us", timezone: "America/Los_Angeles" },
  { id: "austin", label: "Austin, TX", coords: { lat: 30.2672, lng: -97.7431 }, countryCode: "us", timezone: "America/Chicago" },
  { id: "boston", label: "Boston, MA", coords: { lat: 42.3601, lng: -71.0589 }, countryCode: "us", timezone: "America/New_York" },
  { id: "toronto", label: "Toronto, ON", coords: { lat: 43.6532, lng: -79.3832 }, countryCode: "ca", timezone: "America/Toronto" },
  { id: "london", label: "London", coords: { lat: 51.5072, lng: -0.1276 }, countryCode: "gb", timezone: "Europe/London" },
  { id: "hongkong", label: "Hong Kong", coords: { lat: 22.3193, lng: 114.1694 }, countryCode: "hk", timezone: "Asia/Hong_Kong" },
  { id: "singapore", label: "Singapore", coords: { lat: 1.3521, lng: 103.8198 }, countryCode: "sg", timezone: "Asia/Singapore" },
  { id: "sydney", label: "Sydney", coords: { lat: -33.8688, lng: 151.2093 }, countryCode: "au", timezone: "Australia/Sydney" },
];

export function searchRegions(query: string): Region[] {
  const q = query.trim().toLowerCase();
  if (!q) return REGIONS;
  return REGIONS.filter((r) => r.label.toLowerCase().includes(q));
}

export function findRegionByLabel(label: string): Region | undefined {
  return REGIONS.find((r) => r.label.toLowerCase() === label.trim().toLowerCase());
}

/** Canonical place id for a built-in region, as stored in
 * profiles.playing_area_place_id. */
export function regionPlaceId(region: Region): string {
  return `golfme:${region.id}`;
}
