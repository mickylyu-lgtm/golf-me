import type { GolfCall, GolferProfile } from "../types";
import type { PlayingArea } from "./geo";
import { haversineMiles } from "./geo";
import { COURSES, areaForCourse, coordsForCourse } from "./courses";

// Real distance from an effective (saved or temporary) playing area to a
// Golf Call's course, when both have known coordinates — otherwise falls
// straight back to the call's existing mock distanceMiles, so nothing
// regresses for golfers without a coordinate-backed location. Used to make
// location/radius the first eligibility factor in Auto-Match and Golf
// Calls, ahead of preference compatibility.
export function resolveCallDistanceMiles(call: GolfCall, location: PlayingArea): number {
  const courseCoords = coordsForCourse(call.course);
  if (location.coords && courseCoords) return haversineMiles(location.coords, courseCoords);
  return call.distanceMiles;
}

export interface CourseResult {
  name: string;
  area?: string;
  distanceMiles?: number; // only set when both the location and the course have known coordinates
}

function toResult(name: string, location?: PlayingArea): CourseResult {
  const coords = coordsForCourse(name);
  const distanceMiles = location?.coords && coords ? haversineMiles(location.coords, coords) : undefined;
  return { name, area: areaForCourse(name), distanceMiles };
}

// The shared course-lookup surface used everywhere a golfer searches for or
// gets suggested a course (CoursePicker, Create Golf Call, Find a Round).
// Backed by the static COURSES list today; swap the internals for a real
// course-data API later without touching any caller — every function here
// keeps the same signature/shape.

// Query-only search across every known course. Location-aware but never
// blocking: when `location` has coordinates, in-range/closer courses sort
// first, but out-of-region matches still show up rather than being hidden.
export function searchCourses(query: string, location?: PlayingArea, limit = 8): CourseResult[] {
  const q = query.trim().toLowerCase();
  const matches = (q ? COURSES.filter((c) => c.toLowerCase().includes(q)) : COURSES).map((c) => toResult(c, location));
  return matches
    .sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY))
    .slice(0, limit);
}

export function getNearbyCourses(location: PlayingArea, radiusMiles: number): CourseResult[] {
  if (!location.coords) return [];
  return COURSES.map((c) => toResult(c, location))
    .filter((r) => r.distanceMiles !== undefined && r.distanceMiles <= radiusMiles)
    .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
}

export interface RecommendationContext {
  /** Every visible golfer, used only for a lightweight "how many golfers
   * like this course" popularity signal — never anything more invasive. */
  allGolfers: GolferProfile[];
  playedCourseNames?: Set<string>;
}

// Rule-based mock ranking — explicitly NOT a recommendation engine / AI.
// Distance dominates; preferred/played-before/popularity are small nudges.
// Budget and course-type aren't modeled since there's no real per-course
// price or type data in this prototype. Returns [] with no coordinates
// (see the "no courses found" empty state in the callers) rather than
// guessing at fake nearby results.
export function getRecommendedCourses(user: GolferProfile, location: PlayingArea, ctx: RecommendationContext, limit = 6): CourseResult[] {
  if (!location.coords) return [];

  const popularity = new Map<string, number>();
  for (const g of ctx.allGolfers) {
    for (const c of g.preferredCourses) popularity.set(c, (popularity.get(c) ?? 0) + 1);
    for (const c of g.favoriteCourses) popularity.set(c, (popularity.get(c) ?? 0) + 1);
  }

  return COURSES.map((c) => toResult(c, location))
    .filter((r): r is CourseResult & { distanceMiles: number } => r.distanceMiles !== undefined)
    .map((r) => {
      let score = Math.max(0, 100 - r.distanceMiles * 2); // closer = higher, ~50mi out = 0
      if (user.preferredCourses.includes(r.name)) score += 15;
      if (ctx.playedCourseNames?.has(r.name)) score += 10;
      score += Math.min(10, (popularity.get(r.name) ?? 0) * 2);
      return { result: r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.result);
}
