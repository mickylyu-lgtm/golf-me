// "Is this course in the US?" (where NAIP exists). Shared by the client
// (src/lib/satelliteTiles.ts re-exports it) and course-photos (which only
// fetches a NAIP picture for US courses). Pure.
//
// The course's country, when we have it (real courses: Geoapify's country,
// stored in public.courses), decides. Without it (demo fixtures, old rows) a
// coarse box test: the contiguous US, Alaska, Hawaii, Puerto Rico + USVI,
// Guam + the Northern Marianas, American Samoa. The contiguous box also
// takes in the strip of Canada south of 49°N and a sliver of northern
// Mexico; a course there gets no NAIP tiles (they 404), the image fails to
// load and the view falls back to its placeholder, so a wrong guess costs
// nothing.
const US_COUNTRY_NAMES = new Set([
  "us", "usa", "u.s.", "u.s.a.", "united states", "united states of america",
  "pr", "puerto rico", "vi", "u.s. virgin islands", "united states virgin islands", "us virgin islands",
  "gu", "guam", "mp", "northern mariana islands", "as", "american samoa",
]);

const US_BOXES: [number, number, number, number][] = [
  // [south, west, north, east]
  [24.3, -125.0, 49.4, -66.8], // contiguous US
  [51.0, -180.0, 71.6, -129.9], // Alaska (incl. the Aleutians west of 180 below)
  [51.0, 172.0, 53.1, 180.0], // western Aleutians
  [18.8, -160.4, 22.4, -154.7], // Hawaii
  [17.6, -67.4, 18.6, -64.5], // Puerto Rico + USVI
  [13.2, 144.5, 20.6, 146.1], // Guam + Northern Marianas
  [-14.6, -171.2, -11.0, -168.1], // American Samoa
];

export function isUsCourse(lat: number | undefined, lng: number | undefined, country?: string | null): boolean {
  const c = country?.trim().toLowerCase();
  if (c) return US_COUNTRY_NAMES.has(c);
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return US_BOXES.some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e);
}
