// Real (non-demo) course search — Geoapify via the `course-search` Edge
// Function, cached into public.courses. Deliberately separate from
// courseSearch.ts, which stays exactly as it was: that file is now demo
// mode's fixture-backed implementation (and still powers Golf Calls'
// distance display for the existing mock round data, untouched by this
// phase), while this file is real accounts' provider-backed implementation.
// Same conceptual surface (search/nearby/getById/recommended), never mixed
// at runtime — every caller branches on isDemo and picks one or the other.
import { supabase } from "./supabase";
import { haversineMiles } from "./geo";
import type { PlayingArea, GeoPoint } from "./geo";
import type { GolferProfile } from "../types";

export class CourseSearchError extends Error {}

export interface RealCourseResult {
  id: string; // courses.id — stable, usable with getCourseById, and as golf_calls.course_id
  name: string;
  city?: string;
  region?: string;
  area?: string; // "city, region" for display, mirrors the mock's `area` field
  distanceMiles?: number;
  lat: number;
  lng: number;
}

interface CourseRow {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
}

function rowToResult(row: CourseRow, location?: PlayingArea): RealCourseResult {
  const area = [row.city, row.region].filter(Boolean).join(", ") || undefined;
  const distanceMiles = location?.coords ? haversineMiles(location.coords, { lat: row.latitude, lng: row.longitude } satisfies GeoPoint) : undefined;
  return { id: row.id, name: row.name, city: row.city ?? undefined, region: row.region ?? undefined, area, distanceMiles, lat: row.latitude, lng: row.longitude };
}

function sortByDistance(results: RealCourseResult[]): RealCourseResult[] {
  return [...results].sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY));
}

async function invokeCourseSearch(mode: "search" | "nearby", params: Record<string, unknown>): Promise<CourseRow[]> {
  const { data, error } = await supabase.functions.invoke("course-search", { body: { mode, ...params } });
  if (error) throw new CourseSearchError(error.message || "Course search failed. Please try again.");
  const body = data as { results?: CourseRow[]; error?: string } | null;
  if (body?.error) throw new CourseSearchError(body.error);
  return body?.results ?? [];
}

export async function searchRealCourses(query: string, location?: PlayingArea, limit = 8): Promise<RealCourseResult[]> {
  const rows = await invokeCourseSearch("search", { query, lat: location?.coords?.lat, lng: location?.coords?.lng, limit });
  return sortByDistance(rows.map((r) => rowToResult(r, location)));
}

export async function getNearbyRealCourses(location: PlayingArea, radiusMiles: number, limit = 10): Promise<RealCourseResult[]> {
  if (!location.coords) return [];
  const rows = await invokeCourseSearch("nearby", { lat: location.coords.lat, lng: location.coords.lng, radiusMiles, limit });
  return sortByDistance(rows.map((r) => rowToResult(r, location)));
}

export async function getRealCourseById(id: string): Promise<RealCourseResult | null> {
  const { data, error } = await supabase.from("courses").select("id, name, city, region, latitude, longitude").eq("id", id).maybeSingle();
  if (error) throw new CourseSearchError(error.message);
  return data ? rowToResult(data as CourseRow) : null;
}

// Distance-led ranking with a small nudge for a golfer's own preferred
// courses — no cross-account popularity signal here (unlike the mock's
// version), since that would mean reading every other real account's
// preferences, which isn't what visibleGolfers()-style mock popularity was
// ever meant to model for real, private accounts.
export async function getRecommendedRealCourses(user: GolferProfile, location: PlayingArea, limit = 6): Promise<RealCourseResult[]> {
  if (!location.coords) return [];
  const nearby = await getNearbyRealCourses(location, 50, limit * 3);
  return nearby
    .map((r) => ({
      result: r,
      score: Math.max(0, 100 - (r.distanceMiles ?? 50) * 2) + (user.preferredCourses.includes(r.name) ? 15 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.result);
}
