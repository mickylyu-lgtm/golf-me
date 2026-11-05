// Is this Google Places result the same golf course GolfMe knows? Pure, so
// the rule is tested under node (tests/placesMatch.test.ts) and the
// course-photos Edge Function uses exactly the same code.
//
// A wrong photo is worse than none: the place must be a golf course, close
// to our coordinates, and name the same course. Our coordinates come from
// Geoapify (OpenStreetMap) or GolfCourseAPI and can sit anywhere on the
// grounds (clubhouse, entrance, middle of the course), so distance alone is
// loose and the name has to agree.
import { distinctiveWords, namesASiblingCourse } from "./coursePhotoMatch.ts";

export interface PlaceAuthorAttribution {
  displayName?: string;
  uri?: string;
  photoUri?: string;
}

export interface PlacePhoto {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: PlaceAuthorAttribution[];
  googleMapsUri?: string;
}

export interface PlaceCandidate {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  photos?: PlacePhoto[];
  googleMapsUri?: string;
}

export interface CourseRef {
  name: string;
  lat: number;
  lng: number;
}

// A named match may be this far from our point (a big 36-hole facility is
// ~2 km end to end, and two providers can pin opposite ends of it).
export const NAMED_MATCH_MAX_M = 2500;
// A course or place with only generic words in its name ("Golf Course",
// "Municipal Golf Links") can only match when the two points nearly agree.
export const GENERIC_MATCH_MAX_M = 250;

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type NameMatch = "named" | "generic" | "none";

/** "named": both names share a distinctive word (Dyker, Bethpage). "generic":
 * at least one name has no distinctive word at all, so the name can't say
 * either way. "none": both name a place and they differ, or their
 * distinguishing words (Black/Red, 9/18) disagree. */
export function compareCourseNames(courseName: string, placeName: string): NameMatch {
  if (namesASiblingCourse(courseName, placeName)) return "none";
  const mine = distinctiveWords(courseName);
  const theirs = distinctiveWords(placeName);
  if (mine.length === 0 || theirs.length === 0) return "generic";
  const set = new Set(theirs);
  return mine.some((w) => set.has(w)) ? "named" : "none";
}

export interface PlaceMatchResult {
  ok: boolean;
  distanceM: number | null;
  name: NameMatch;
  reason: "ok" | "not_golf" | "no_location" | "too_far" | "name_mismatch";
}

export function placeMatchesCourse(course: CourseRef, place: PlaceCandidate): PlaceMatchResult {
  const name = compareCourseNames(course.name, place.displayName?.text ?? "");
  if (place.types && !place.types.includes("golf_course")) return { ok: false, distanceM: null, name, reason: "not_golf" };
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, distanceM: null, name, reason: "no_location" };
  }
  const distanceM = Math.round(distanceMeters(course.lat, course.lng, lat, lng));
  if (name === "none") return { ok: false, distanceM, name, reason: "name_mismatch" };
  const limit = name === "named" ? NAMED_MATCH_MAX_M : GENERIC_MATCH_MAX_M;
  if (distanceM > limit) return { ok: false, distanceM, name, reason: "too_far" };
  return { ok: true, distanceM, name, reason: "ok" };
}

/** The best matching place: a named match before a generic one, then the
 * nearest. Null when none passes. */
export function pickMatchingPlace(course: CourseRef, places: PlaceCandidate[]): { place: PlaceCandidate; match: PlaceMatchResult } | null {
  let best: { place: PlaceCandidate; match: PlaceMatchResult } | null = null;
  for (const place of places) {
    if (!place?.id) continue;
    const match = placeMatchesCourse(course, place);
    if (!match.ok) continue;
    if (
      !best ||
      (match.name === "named" && best.match.name !== "named") ||
      (match.name === best.match.name && (match.distanceM ?? Infinity) < (best.match.distanceM ?? Infinity))
    ) {
      best = { place, match };
    }
  }
  return best;
}

/** Which of a place's photos to show. Google photos carry no title or
 * caption, so content can't be checked; shape is the signal we have: a
 * course reads wide, while logos, menus, signs and scorecards are mostly
 * square or portrait. Among the first ten (Google orders by relevance): the
 * first large landscape one, else the first landscape one, else none, so
 * the view falls back to aerial imagery rather than risk a logo. */
export const WIDE_RATIO = 1.3;
export const LARGE_WIDTH_PX = 1000;

export function pickPlacePhoto(photos: PlacePhoto[] | undefined): PlacePhoto | null {
  const usable = (photos ?? []).filter((p) => typeof p?.name === "string" && p.name.startsWith("places/")).slice(0, 10);
  const wide = usable.filter((p) => (p.widthPx ?? 0) >= (p.heightPx ?? Infinity) * WIDE_RATIO);
  return wide.find((p) => (p.widthPx ?? 0) >= LARGE_WIDTH_PX) ?? wide[0] ?? null;
}
