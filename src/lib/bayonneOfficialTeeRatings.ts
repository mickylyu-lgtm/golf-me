import type { CourseTeeRating, CourseTeeRatings } from "./courseTeeRatings";

export const BAYONNE_OFFICIAL_COURSE_ID = "1f733c43-78d3-4186-ab1c-3ad270a1d456";
export const BAYONNE_OFFICIAL_SCORECARD_URL = "https://www.bayonnegolfclub.com/Bayonne_Golf_Course";
export const BAYONNE_SCORECARD_REVIEWED_ON = "2026-11-22";
// Exclusive cutoff. Re-check the club's scorecard before renewing this pilot.
export const BAYONNE_SCORECARD_EXPIRES_AT = "2027-02-20T00:00:00Z";
const FIRST_VALID_MS = Date.parse(BAYONNE_SCORECARD_REVIEWED_ON + "T00:00:00Z");
const EXPIRY_MS = Date.parse(BAYONNE_SCORECARD_EXPIRES_AT);

// Official club's Rating and Slope tables, 18 holes only. Do not fill gaps
// from GolfCourseAPI, estimate Bogey Rating, or infer other rating groups.
const OFFICIAL_TEES: readonly [string, CourseTeeRating["group"], number, number][] = [
  ["Black", "men", 75.0, 151],
  ["Green", "men", 73.7, 148],
  ["Blue", "men", 72.0, 148],
  ["White", "men", 70.0, 133],
  ["Red", "women", 72.3, 127],
];

export function isBayonneOfficialCourse(courseId: string | undefined): boolean {
  return courseId === BAYONNE_OFFICIAL_COURSE_ID;
}

function isReviewedWindow(now: number): boolean {
  return Number.isFinite(now) && now >= FIRST_VALID_MS && now < EXPIRY_MS;
}

export function bayonneOfficialTeeRatings(courseId: string | undefined, now = Date.now()): CourseTeeRatings | null {
  if (!isBayonneOfficialCourse(courseId) || !isReviewedWindow(now)) return null;
  return {
    source: { url: BAYONNE_OFFICIAL_SCORECARD_URL, reviewedOn: BAYONNE_SCORECARD_REVIEWED_ON },
    tees: OFFICIAL_TEES.map(([name, group, course, slope]) => ({
      name, group, holes: 18,
      overall: { course, slope, bogey: null },
      front: { course: null, slope: null, bogey: null },
      back: { course: null, slope: null, bogey: null },
    })),
  };
}

export function courseTeeRatingsSource(courseId: string | undefined, access: {
  signedIn: boolean;
  isDemo: boolean;
  /** Bayonne-only snapshot defaults on. An explicit false is the kill switch. */
  bayonnePilot?: string;
  provider: boolean;
}, now = Date.now()): "bayonne" | "provider" | null {
  if (!courseId || !access.signedIn || access.isDemo) return null;
  // Never fall through to the vendor for the pilot course, including expiry.
  if (isBayonneOfficialCourse(courseId)) {
    return access.bayonnePilot !== "false" && isReviewedWindow(now) ? "bayonne" : null;
  }
  return access.provider ? "provider" : null;
}
