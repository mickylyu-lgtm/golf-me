// Geoapify request building and response shaping for the course-search
// Edge Function, kept free of Deno/Supabase imports so tests/ can run it
// under plain node --test (same pattern as courseFilter.ts).
//
// Why two providers for a typed course name (Micky, 2026-11-03: "Rock
// Spring Golf Club ... is not there as an option"): the Places API has no
// free-text parameter. The function used to send `text=`, which Places
// silently ignores, so a typed search really returned the 20 golf courses
// nearest the searcher, whatever they typed, and any course outside that
// ring (Rock Spring, West Orange NJ, from Manhattan) could never be found.
// Now a name search asks both:
//   - Places with `name=` (golf-course category only), and
//   - the Geocoding API with `text=`, which does match free text and tags
//     each hit with a Places category; only golf courses are kept.
//
// Place search ("Astoria", "11103", "Hoboken") turns a typed area into
// coordinates rounded to 2 decimals (~1 km), the same precision profiles
// store (lib/coarseLocation.ts, migration 20260930090000). Nothing about
// a place search is written to the database.
import { geoapifyCourseName, looksLikeGolfName, rejectGeoapifyCourse } from "./courseFilter.ts";
import type { GeoapifyCourseFeatureProps } from "./courseFilter.ts";

export const GEOAPIFY_GOLF_CATEGORY = "sport.golf_course";
export const MAX_QUERY_LENGTH = 80;

export interface CourseCandidate extends GeoapifyCourseFeatureProps {
  place_id: string;
  lat: number;
  lon: number;
  city?: string;
  state?: string;
  country?: string;
  formatted?: string;
}

// A Geocoding API result (format=json). Only the fields used here.
export interface GeocodeResult {
  place_id?: string;
  name?: string;
  city?: string;
  suburb?: string;
  district?: string;
  county?: string;
  state?: string;
  state_code?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
  formatted?: string;
  lat?: number;
  lon?: number;
  result_type?: string;
  category?: string;
  datasource?: { raw?: Record<string, unknown> };
}

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
}

export const cleanQuery = (q: unknown): string => (typeof q === "string" ? q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH) : "");

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const coarsen = (n: number): number => Math.round(n * 100) / 100;

function proximity(lat?: number, lng?: number): string | null {
  return finite(lat) && finite(lng) ? `proximity:${lng},${lat}` : null;
}

// Places, filtered to golf courses whose name matches the query.
export function placesByNameUrl(apiKey: string, query: string, lat?: number, lng?: number): string {
  const params = new URLSearchParams({ categories: GEOAPIFY_GOLF_CATEGORY, name: query, limit: "20", apiKey });
  const bias = proximity(lat, lng);
  if (bias) params.set("bias", bias);
  return `https://api.geoapify.com/v2/places?${params.toString()}`;
}

// Geocoding free-text search for a POI (a course) by name.
export function geocodeAmenityUrl(apiKey: string, query: string, lat?: number, lng?: number): string {
  const params = new URLSearchParams({ text: query, type: "amenity", format: "json", limit: "10", apiKey });
  const bias = proximity(lat, lng);
  if (bias) params.set("bias", bias);
  return `https://api.geoapify.com/v1/geocode/search?${params.toString()}`;
}

// Geocoding autocomplete for an area (town, neighbourhood, zip code).
export function placeAutocompleteUrl(apiKey: string, query: string, lat?: number, lng?: number): string {
  const params = new URLSearchParams({ text: query, format: "json", limit: "8", apiKey });
  const bias = proximity(lat, lng);
  if (bias) params.set("bias", bias);
  return `https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`;
}

// A geocoder hit is a course when Geoapify tags it with the golf-course
// category, or (no category at all) its name reads like a golf venue.
// Mini golf / ranges are still rejected by the shared course filter.
export function geocodeResultToCourse(r: GeocodeResult): CourseCandidate | null {
  if (!r.place_id || !finite(r.lat) || !finite(r.lon)) return null;
  const category = typeof r.category === "string" ? r.category : "";
  const isGolf = category.startsWith(GEOAPIFY_GOLF_CATEGORY) || (!category && looksLikeGolfName(r.name));
  if (!isGolf) return null;
  const candidate: CourseCandidate = {
    place_id: r.place_id,
    name: r.name,
    categories: category ? [category] : [],
    datasource: r.datasource,
    lat: r.lat,
    lon: r.lon,
    city: r.city,
    state: r.state,
    country: r.country,
    formatted: r.formatted,
  };
  return rejectGeoapifyCourse(candidate) === null ? candidate : null;
}

// Places features first (their tags are richer), then geocoder hits; one
// entry per Geoapify place, and per name at (about) the same spot.
export function mergeCourseCandidates(...lists: CourseCandidate[][]): CourseCandidate[] {
  const out: CourseCandidate[] = [];
  const seenIds = new Set<string>();
  const seenSpots = new Set<string>();
  for (const list of lists)
    for (const c of list) {
      const spot = `${geoapifyCourseName(c).toLowerCase()}@${coarsen(c.lat)},${coarsen(c.lon)}`;
      if (seenIds.has(c.place_id) || seenSpots.has(spot)) continue;
      seenIds.add(c.place_id);
      seenSpots.add(spot);
      out.push(c);
    }
  return out;
}

// Area kinds worth offering as "where I play"; never a street or a house.
const PLACE_TYPES = new Set(["city", "suburb", "district", "postcode", "county"]);

function placeLabel(r: GeocodeResult): string | null {
  const region = r.state_code && r.country_code?.toLowerCase() === "us" ? r.state_code : (r.state ?? r.country);
  const join = (...parts: (string | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(", ") || null;
  switch (r.result_type) {
    case "postcode":
      return r.postcode ? join(`${r.postcode}${r.city ? ` ${r.city}` : ""}`, region) : null;
    case "suburb":
    case "district":
      return join(r.suburb ?? r.district ?? r.name, r.city, region);
    case "city":
      return join(r.city ?? r.name, region);
    case "county":
      return join(r.county ?? r.name, region);
    default:
      return null;
  }
}

export function toPlaceResults(results: GeocodeResult[], limit = 6): PlaceResult[] {
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.result_type || !PLACE_TYPES.has(r.result_type) || !finite(r.lat) || !finite(r.lon)) continue;
    const label = placeLabel(r);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ label: label.slice(0, 80), lat: coarsen(r.lat), lng: coarsen(r.lon) });
    if (out.length >= limit) break;
  }
  return out;
}
