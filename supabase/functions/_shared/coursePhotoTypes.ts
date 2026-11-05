// What the course-photos Edge Function answers, shared with the client
// (src/lib/courseImageryClient.ts) so both sides agree on the shape.

export type CoursePhotoSize = "thumb" | "hero";

export interface PhotoAuthor {
  name: string;
  uri?: string;
}

/** A Google Places photo. `url` is a short-lived googleusercontent link
 * fetched for this request; nothing about the photo is stored by GolfMe
 * (Google: photo names can't be cached). The author attribution must be
 * shown wherever the photo is shown large, plus "Google Maps". */
export interface GooglePhotoOut {
  source: "google";
  url: string;
  authors: PhotoAuthor[];
  /** The photo (or the place) on Google Maps, so the source is reachable. */
  mapsUri?: string;
}

/** A Wikimedia Commons file (freely licensed; URL + credit are stored). */
export interface WikimediaPhotoOut {
  source: "wikimedia";
  url: string;
  /** "Author, LICENSE / Wikimedia Commons". */
  credit: string;
  pageUrl: string;
  license: string | null;
}

export type CoursePhotoOut = GooglePhotoOut | WikimediaPhotoOut;

export interface CoursePhotosRequest {
  courseIds: string[];
  size?: CoursePhotoSize;
  /** Only the outlines (no photo lookups, so no billable photo calls):
   * for satellite-only views. */
  outlineOnly?: boolean;
}

export interface CoursePhotosResponse {
  /** Every requested id that exists: a photo, or null for "none". Ids not
   * present weren't resolved this time (cap reached, provider error): the
   * client shows its fallback and may ask again on a later visit. */
  photos: Record<string, CoursePhotoOut | null>;
  /** The course's OpenStreetMap outline (bounding box), so satellite views
   * frame the holes rather than our single point (often the clubhouse).
   * null = no outline known; missing = not resolved this time. */
  bounds?: Record<string, CourseBounds | null>;
}

export type { CourseBounds } from "./courseBounds.ts";
import type { CourseBounds } from "./courseBounds.ts";

export const MAX_COURSE_IDS_PER_REQUEST = 12;
export const PHOTO_WIDTH_PX: Record<CoursePhotoSize, number> = { thumb: 240, hero: 1200 };
