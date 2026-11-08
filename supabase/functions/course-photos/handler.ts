// course-photos: the best real photo of each requested course, server-side.
// Everything with side effects (fetch, the database, env, the clock) comes
// in through `Deps`, so handler.test.ts runs it against stubs; index.ts
// wires the real ones. No Deno or npm imports here.
//
// Sources, in order (Micky, 2026-11-05):
//   1. Google Places (New), only when GOOGLE_PLACES_API_KEY is set. Once
//      per course: Text Search for a golf_course near the course's
//      coordinates, then the name/distance check in _shared/placesMatch.ts.
//      The matched place id is stored (Google exempts place ids from its
//      caching limits). Per request: Place Details asking only for
//      `photos` (the free "IDs Only" SKU) for a fresh photo name, then one
//      Place Photo call (skipHttpRedirect) for a short-lived image URL.
//      Photo names and URLs are never stored ("You cannot cache a photo
//      name"). The response carries the author attributions to show.
//   2. Wikimedia Commons: the article/geotag lookup the browser used to do
//      (rules in _shared/coursePhotoMatch.ts), now with a license check;
//      the chosen file's URL + credit are stored (freely licensed).
//   3. Nothing: the client falls back to satellite.
//
// Cost controls: lookups are cached per course in public.course_imagery
// (a "no match" too, re-checked after a while); every billable call first
// takes a unit of a hard per-day cap (course_imagery_take_quota); the
// client only asks for courses it is showing, batched, once per session.
import {
  MAX_COURSE_IDS_PER_REQUEST,
  PHOTO_WIDTH_PX,
  type CoursePhotoOut,
  type CoursePhotoSize,
  type CoursePhotosResponse,
  type PhotoAuthor,
} from "../_shared/coursePhotoTypes.ts";
import { pickMatchingPlace, pickPlacePhoto, type PlaceCandidate, type PlacePhoto } from "../_shared/placesMatch.ts";
import {
  articleMatchesCourse,
  classifyCommonsLicense,
  commonsFileMatchesCourse,
  isCommonsUrl,
  photoCourseScore,
  photoShowsCourse,
  plainArtist,
} from "../_shared/coursePhotoMatch.ts";
import { outlineFromGeoapifyFeature, overpassQuery, pickCourseOutline, validBounds, type CourseBounds } from "../_shared/courseBounds.ts";
import type { CoursePictureOut } from "../_shared/coursePhotoTypes.ts";
import {
  FOSSGIS_OVERPASS_ENDPOINTS,
  askLayoutWithRetry,
  classifyOverpassAnswer,
  isLayoutAnswer,
  layoutOverpassQuery,
  type CourseLayout,
  type LayoutAnswer,
  type OverpassVerdict,
} from "../_shared/courseLayout.ts";
import { looksLikeJpeg, naipExportFor, naipExportUrl, validMercBox, type MercBox, type NaipExport } from "../_shared/naipExport.ts";
import { isUsCourse } from "../_shared/usCoverage.ts";

export interface CourseRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** The course's Geoapify place id (course_external_ids), when known. */
  geoapify_place_id?: string | null;
}

export interface ImageryRow {
  course_id: string;
  google_place_id?: string | null;
  google_match_distance_m?: number | null;
  google_checked_at?: string | null;
  wikimedia_file?: string | null;
  wikimedia_url?: string | null;
  wikimedia_thumb_url?: string | null;
  wikimedia_page_url?: string | null;
  wikimedia_artist?: string | null;
  wikimedia_license?: string | null;
  wikimedia_license_class?: string | null;
  wikimedia_checked_at?: string | null;
  outline_south?: number | null;
  outline_west?: number | null;
  outline_north?: number | null;
  outline_east?: number | null;
  outline_source?: string | null;
  outline_checked_at?: string | null;
  // 20261107190000: the course page's detail.
  layout?: unknown;
  layout_status?: "ok" | "unmapped" | null;
  layout_checked_at?: string | null;
  naip_path?: string | null;
  naip_bbox?: MercBox | null;
  naip_width?: number | null;
  naip_height?: number | null;
  naip_checked_at?: string | null;
}

export interface Store {
  courses(ids: string[]): Promise<CourseRow[]>;
  imagery(ids: string[]): Promise<ImageryRow[]>;
  /** Upsert by course_id; only the given columns change. */
  saveImagery(row: ImageryRow): Promise<void>;
  /** Takes `cost` units of today's cap for `provider`; false when full. */
  takeQuota(provider: string, cap: number, cost?: number): Promise<boolean>;
  /** Store a NAIP picture in the public course-imagery bucket. */
  uploadPicture(path: string, bytes: Uint8Array): Promise<void>;
  /** The public URL of an object in that bucket. */
  publicPictureUrl(path: string): string;
}

export interface Deps {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  store: Store;
  now: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
  /** Keep a promise running after the response (EdgeRuntime.waitUntil).
   * Without it a slow layout lookup is simply awaited. */
  background?: (p: Promise<unknown>) => void;
  /** Tests: the retry pause, its jitter and elapsed time. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => number;
}

export const QUOTA = {
  textSearch: "google_text_search",
  details: "google_place_details",
  photo: "google_photo",
  wikimedia: "wikimedia",
  geoapifyDetails: "geoapify_place_details",
  overpass: "overpass",
  overpassLayout: "overpass_layout",
  usgsExport: "usgs_export",
} as const;

// Per UTC day. Text Search Pro: 5,000 free a month, so 150/day stays inside
// it. Place Photo: 1,000 free a month, then $7 per 1,000, so 300/day caps
// the month at ~$56. Place Details with only `photos` is the free IDs Only
// SKU; capped anyway. Wikimedia is free; capped to stay polite.
export const DEFAULT_CAPS = {
  [QUOTA.textSearch]: 150,
  [QUOTA.details]: 3000,
  [QUOTA.photo]: 300,
  [QUOTA.wikimedia]: 1000,
  // Geoapify Place Details: 1 credit each, once per course (free plan: 3,000
  // credits a day, shared with course-search). Overpass: a free public
  // service with a fair-use limit (~10,000 queries a day per user).
  [QUOTA.geoapifyDetails]: 500,
  [QUOTA.overpass]: 500,
  // Layouts: once per course, then stored. Overpass's policy (OSM wiki,
  // 2026-11): an app's usage is the sum over all its users, and regular
  // automated use should stay near ~100 queries / 10 MB a day; a big
  // facility's answer is up to ~2 MB. So a small cap.
  [QUOTA.overpassLayout]: 40,
  // NAIP picture renders (a hedge counts too): free, but a shared public
  // service; once per course, then stored.
  [QUOTA.usgsExport]: 300,
} as const;

const CAP_ENV: Record<string, string> = {
  [QUOTA.textSearch]: "COURSE_PHOTOS_DAILY_TEXT_SEARCH_CAP",
  [QUOTA.details]: "COURSE_PHOTOS_DAILY_DETAILS_CAP",
  [QUOTA.photo]: "COURSE_PHOTOS_DAILY_PHOTO_CAP",
  [QUOTA.wikimedia]: "COURSE_PHOTOS_DAILY_WIKIMEDIA_CAP",
  [QUOTA.geoapifyDetails]: "COURSE_PHOTOS_DAILY_GEOAPIFY_DETAILS_CAP",
  [QUOTA.overpass]: "COURSE_PHOTOS_DAILY_OVERPASS_CAP",
  [QUOTA.overpassLayout]: "COURSE_PHOTOS_DAILY_OVERPASS_LAYOUT_CAP",
  [QUOTA.usgsExport]: "COURSE_PHOTOS_DAILY_USGS_EXPORT_CAP",
};

// The layout comes from FOSSGIS's two public Overpass servers only
// (overpass-api.de and z.overpass-api.de: one operator, one policy; no
// third-party mirror sees which courses GolfMe users look at). One retry on
// the other server (_shared/courseLayout askLayoutWithRetry).
export const LAYOUT_OVERPASS_ENDPOINTS = FOSSGIS_OVERPASS_ENDPOINTS;
// 2026-11-07 (Micky, Silver Lake: "Couldn't load the course layout"): the
// single 40 s ask lost to 11-50 s Overpass answers. Now a request waits up
// to LAYOUT_WAIT_MS for the answer; past that it says "pending" and the
// lookup carries on in the background (EdgeRuntime.waitUntil) for up to
// LAYOUT_JOB_BUDGET_MS, storing the result; the course page asks again a
// little later and gets the stored layout. 20 s keeps every response well
// under the iPhone web view's 60 s request timeout. The job budget leaves
// room inside the function's 150 s wall clock.
export const LAYOUT_WAIT_MS = 20_000;
export const LAYOUT_JOB_BUDGET_MS = 110_000;
// A lookup started this recently (layout_checked_at with no status yet) is
// still running somewhere: say "pending", don't start a second one.
export const LAYOUT_PENDING_MS = 150_000;
export const LAYOUT_OK_RECHECK_MS = 90 * 24 * 60 * 60 * 1000;
// A course with nothing mapped: OSM volunteers map courses all the time.
export const LAYOUT_UNMAPPED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
export const NAIP_HEDGE_AFTER_MS = 4000;
const NAIP_SERVER_TIMEOUT_MS = 45_000;
const NAIP_MIN_BYTES = 20_000;
// The bucket's own limit (20261107190000).
const NAIP_MAX_BYTES = 3 * 1024 * 1024;

// Overpass endpoints, tried in order. FOSSGIS's two servers only
// (2026-11-06: maps.mail.ru dropped, so no third-party mirror sees which
// courses GolfMe users look at; 2026-11-07: z.overpass-api.de, FOSSGIS's
// second server, added). They are often overloaded; a failure isn't
// recorded, so the outline is simply asked again on a later view.
export const OVERPASS_ENDPOINTS = FOSSGIS_OVERPASS_ENDPOINTS;
const OVERPASS_TIMEOUT_MS = 8000;
export const OUTLINE_RECHECK_MS = 180 * 24 * 60 * 60 * 1000;

// A course with no Google match is asked again after 90 days (new listings,
// new photos); one with no Commons photo after 30.
export const GOOGLE_RECHECK_MS = 90 * 24 * 60 * 60 * 1000;
export const WIKIMEDIA_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACES_BASE = "https://places.googleapis.com/v1";
const TEXT_SEARCH_FIELDS = "places.id,places.displayName,places.location,places.types,places.photos,places.googleMapsUri";
const SEARCH_RADIUS_M = 5000;
const WIKI_UA = "GolfMe/1.0 (https://golfme.app) course-photos";
const COMMONS_RADIUS_M = 600;
const COMMONS_HERO_WIDTH = 960;
const COMMONS_THUMB_WIDTH = 250;

function cap(deps: Deps, provider: string): number {
  const raw = deps.env(CAP_ENV[provider] ?? "");
  const n = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : (DEFAULT_CAPS as Record<string, number>)[provider] ?? 0;
}

export function cleanCourseIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && UUID_RE.test(v) && !out.includes(v.toLowerCase())) out.push(v.toLowerCase());
    if (out.length >= MAX_COURSE_IDS_PER_REQUEST) break;
  }
  return out;
}

function stale(checkedAt: string | null | undefined, maxAgeMs: number, now: Date): boolean {
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt);
  return !Number.isFinite(t) || now.getTime() - t > maxAgeMs;
}

/** Ask Google again? Never once a place is matched (its id is kept); after
 * GOOGLE_RECHECK_MS when the last lookup found nothing. */
export function needsGoogleLookup(row: ImageryRow, now: Date): boolean {
  if (row.google_place_id) return false;
  return stale(row.google_checked_at, GOOGLE_RECHECK_MS, now);
}

export function needsWikimediaLookup(row: ImageryRow, now: Date): boolean {
  if (row.wikimedia_url) return false;
  return stale(row.wikimedia_checked_at, WIKIMEDIA_RECHECK_MS, now);
}

function httpsOrUndefined(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  try {
    return new URL(u).protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

function authorsOf(photo: PlacePhoto): PhotoAuthor[] {
  return (photo.authorAttributions ?? [])
    .filter((a) => typeof a?.displayName === "string" && a.displayName.trim() !== "")
    .slice(0, 3)
    .map((a) => ({ name: a.displayName!.trim().slice(0, 80), uri: httpsOrUndefined(a.uri) }));
}

function placeMapsLink(placeId: string, courseName: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(courseName)}&query_place_id=${encodeURIComponent(placeId)}`;
}

class ProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function placesJson(deps: Deps, key: string, url: string, init: RequestInit & { fieldMask?: string }): Promise<any> {
  const headers: Record<string, string> = { "X-Goog-Api-Key": key };
  if (init.fieldMask) headers["X-Goog-FieldMask"] = init.fieldMask;
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await deps.fetch(url, { method: init.method ?? "GET", body: init.body, headers });
  if (!res.ok) throw new ProviderError(`places ${res.status}`, res.status);
  return res.json();
}

async function textSearch(deps: Deps, key: string, course: CourseRow): Promise<PlaceCandidate[]> {
  const body = {
    textQuery: course.name,
    includedType: "golf_course",
    strictTypeFiltering: true,
    pageSize: 5,
    locationBias: { circle: { center: { latitude: course.latitude, longitude: course.longitude }, radius: SEARCH_RADIUS_M } },
  };
  const data = await placesJson(deps, key, `${PLACES_BASE}/places:searchText`, {
    method: "POST",
    body: JSON.stringify(body),
    fieldMask: TEXT_SEARCH_FIELDS,
  });
  return Array.isArray(data?.places) ? data.places : [];
}

async function placePhotos(deps: Deps, key: string, placeId: string): Promise<PlacePhoto[]> {
  // Only `photos`: the Place Details Essentials (IDs Only) SKU, no charge.
  const data = await placesJson(deps, key, `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, { fieldMask: "photos" });
  return Array.isArray(data?.photos) ? data.photos : [];
}

async function photoUri(deps: Deps, key: string, photoName: string, size: CoursePhotoSize): Promise<string | null> {
  const url = `${PLACES_BASE}/${photoName}/media?maxWidthPx=${PHOTO_WIDTH_PX[size]}&skipHttpRedirect=true`;
  const data = await placesJson(deps, key, url, {});
  return httpsOrUndefined(data?.photoUri) ?? null;
}

type GoogleOutcome = { photo: CoursePhotoOut | null; unresolved: boolean };

async function fromGoogle(deps: Deps, key: string, course: CourseRow, row: ImageryRow, size: CoursePhotoSize): Promise<GoogleOutcome> {
  const now = deps.now();
  let photo: PlacePhoto | null = null;
  let placeId = row.google_place_id ?? null;
  let mapsUri: string | undefined;

  if (needsGoogleLookup(row, now)) {
    if (!(await deps.store.takeQuota(QUOTA.textSearch, cap(deps, QUOTA.textSearch)))) return { photo: null, unresolved: true };
    const places = await textSearch(deps, key, course);
    const best = pickMatchingPlace({ name: course.name, lat: course.latitude, lng: course.longitude }, places);
    placeId = best?.place.id ?? null;
    const update: ImageryRow = {
      course_id: course.id,
      google_place_id: placeId,
      google_match_distance_m: best?.match.distanceM ?? null,
      google_checked_at: now.toISOString(),
    };
    await deps.store.saveImagery(update);
    Object.assign(row, update);
    if (!best) return { photo: null, unresolved: false };
    photo = pickPlacePhoto(best.place.photos);
    mapsUri = httpsOrUndefined(best.place.googleMapsUri);
  } else if (placeId) {
    if (!(await deps.store.takeQuota(QUOTA.details, cap(deps, QUOTA.details)))) return { photo: null, unresolved: true };
    try {
      photo = pickPlacePhoto(await placePhotos(deps, key, placeId));
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) {
        // The place id went away (merged/closed listing): forget it, so the
        // next request looks the course up again.
        const update: ImageryRow = { course_id: course.id, google_place_id: null, google_match_distance_m: null, google_checked_at: null };
        await deps.store.saveImagery(update);
        Object.assign(row, update);
        return { photo: null, unresolved: false };
      }
      throw err;
    }
  } else {
    return { photo: null, unresolved: false };
  }

  if (!photo || !placeId) return { photo: null, unresolved: false };
  if (!(await deps.store.takeQuota(QUOTA.photo, cap(deps, QUOTA.photo)))) return { photo: null, unresolved: true };
  const url = await photoUri(deps, key, photo.name, size);
  if (!url) return { photo: null, unresolved: false };
  return {
    photo: {
      source: "google",
      url,
      authors: authorsOf(photo),
      mapsUri: httpsOrUndefined(photo.googleMapsUri) ?? mapsUri ?? placeMapsLink(placeId, course.name),
    },
    unresolved: false,
  };
}

// ---- Wikimedia Commons (server-side port of the old browser lookup) ----

async function wikiJson(deps: Deps, base: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", ...params });
  const res = await deps.fetch(`${base}?${qs}`, { headers: { "User-Agent": WIKI_UA, "Api-User-Agent": WIKI_UA } });
  if (!res.ok) throw new ProviderError(`wikimedia ${res.status}`, res.status);
  return res.json();
}

// Wikipedia articles near the course whose lead image is about this
// course, best first (only files that aren't plainly a logo/sign/map).
async function wikipediaLeadFiles(deps: Deps, course: CourseRow): Promise<string[]> {
  const data = await wikiJson(deps, "https://en.wikipedia.org/w/api.php", {
    action: "query",
    generator: "search",
    gsrsearch: `golf nearcoord:2km,${course.latitude},${course.longitude}`,
    gsrlimit: "8",
    prop: "pageimages",
    piprop: "original|name",
  });
  const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .filter((p) => p.pageimage && p.original?.source && isCommonsUrl(p.original.source) && articleMatchesCourse(course.name, p.title, p.pageimage))
    .filter((p) => photoCourseScore({ title: p.pageimage }) >= 0)
    .map((p) => `File:${p.pageimage}`);
}

// Geotagged Commons photos by the course, the ones whose titles say most
// about the course (hole, fairway, green, aerial) first.
async function commonsGeotagFiles(deps: Deps, course: CourseRow): Promise<string[]> {
  const data = await wikiJson(deps, "https://commons.wikimedia.org/w/api.php", {
    action: "query",
    list: "geosearch",
    gscoord: `${course.latitude}|${course.longitude}`,
    gsradius: String(COMMONS_RADIUS_M),
    gsnamespace: "6",
    gslimit: "200",
  });
  return (data?.query?.geosearch ?? [])
    .map((f: any) => String(f.title))
    .filter((t: string) => commonsFileMatchesCourse(course.name, t))
    .map((t: string) => ({ t, score: photoCourseScore({ title: t }) }))
    .filter((x: { score: number }) => x.score >= 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .map((x: { t: string }) => x.t);
}

// How many candidate files to describe before giving up (one API call each).
const MAX_COMMONS_DESCRIBES = 4;

async function describeCommonsFile(deps: Deps, fileTitle: string): Promise<Omit<ImageryRow, "course_id" | "wikimedia_checked_at"> | null> {
  const data = await wikiJson(deps, "https://commons.wikimedia.org/w/api.php", {
    action: "query",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(COMMONS_HERO_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|Categories",
  });
  const page = Object.values<any>(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  const url: string | undefined = info?.thumburl ?? info?.url;
  if (!url || !isCommonsUrl(url)) return null;
  // The photo must show the course (holes, fairways, greens, an aerial),
  // not the clubhouse, a sign, a logo or a map: judged on its title,
  // description and categories together.
  const shows = photoShowsCourse({
    title: fileTitle,
    description: info.extmetadata?.ImageDescription?.value,
    categories: info.extmetadata?.Categories?.value,
  });
  if (!shows) return null;
  const license: string | undefined = info.extmetadata?.LicenseShortName?.value;
  const licenseClass = classifyCommonsLicense(license);
  // A file whose license we can't read isn't shown (Commons only hosts free
  // files, but the credit we must show depends on knowing which license).
  if (!licenseClass) return null;
  return {
    wikimedia_file: fileTitle,
    wikimedia_url: url,
    wikimedia_thumb_url: url.replace(`/${COMMONS_HERO_WIDTH}px-`, `/${COMMONS_THUMB_WIDTH}px-`),
    wikimedia_page_url: httpsOrUndefined(info.descriptionurl) ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`,
    wikimedia_artist: plainArtist(info.extmetadata?.Artist?.value) ?? null,
    wikimedia_license: license ?? null,
    wikimedia_license_class: licenseClass,
  };
}

function wikimediaOut(row: ImageryRow, size: CoursePhotoSize): CoursePhotoOut | null {
  if (!row.wikimedia_url || !row.wikimedia_page_url) return null;
  const credit = [row.wikimedia_artist, row.wikimedia_license].filter(Boolean).join(", ");
  return {
    source: "wikimedia",
    url: size === "thumb" ? (row.wikimedia_thumb_url ?? row.wikimedia_url) : row.wikimedia_url,
    credit: credit ? `${credit} / Wikimedia Commons` : "Wikimedia Commons",
    pageUrl: row.wikimedia_page_url,
    license: row.wikimedia_license ?? null,
  };
}

type WikiOutcome = { photo: CoursePhotoOut | null; unresolved: boolean };

async function fromWikimedia(deps: Deps, course: CourseRow, row: ImageryRow, size: CoursePhotoSize): Promise<WikiOutcome> {
  if (needsWikimediaLookup(row, deps.now())) {
    if (!(await deps.store.takeQuota(QUOTA.wikimedia, cap(deps, QUOTA.wikimedia)))) return { photo: null, unresolved: true };
    const lead = await wikipediaLeadFiles(deps, course).catch(() => [] as string[]);
    const geotagged = await commonsGeotagFiles(deps, course);
    const candidates = [...new Set([...lead, ...geotagged])].slice(0, MAX_COMMONS_DESCRIBES);
    let described: Awaited<ReturnType<typeof describeCommonsFile>> = null;
    for (const file of candidates) {
      described = await describeCommonsFile(deps, file);
      if (described) break;
    }
    const update: ImageryRow = {
      course_id: course.id,
      wikimedia_file: described?.wikimedia_file ?? null,
      wikimedia_url: described?.wikimedia_url ?? null,
      wikimedia_thumb_url: described?.wikimedia_thumb_url ?? null,
      wikimedia_page_url: described?.wikimedia_page_url ?? null,
      wikimedia_artist: described?.wikimedia_artist ?? null,
      wikimedia_license: described?.wikimedia_license ?? null,
      wikimedia_license_class: described?.wikimedia_license_class ?? null,
      wikimedia_checked_at: deps.now().toISOString(),
    };
    await deps.store.saveImagery(update);
    Object.assign(row, update);
  }
  return { photo: wikimediaOut(row, size), unresolved: false };
}

// ---- The course outline (frames satellite views on the holes) ----

function storedOutline(row: ImageryRow): CourseBounds | null {
  const b = { south: row.outline_south, west: row.outline_west, north: row.outline_north, east: row.outline_east };
  return validBounds(b as Partial<CourseBounds>) ? (b as CourseBounds) : null;
}

export function needsOutlineLookup(row: ImageryRow, now: Date): boolean {
  if (storedOutline(row)) return false;
  return stale(row.outline_checked_at, OUTLINE_RECHECK_MS, now);
}

async function geoapifyOutline(deps: Deps, key: string, course: CourseRow): Promise<CourseBounds | null> {
  const url = `https://api.geoapify.com/v2/place-details?id=${encodeURIComponent(course.geoapify_place_id!)}&features=details&apiKey=${encodeURIComponent(key)}`;
  const res = await deps.fetch(url);
  if (!res.ok) throw new ProviderError(`geoapify ${res.status}`, res.status);
  const data = await res.json();
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  return outlineFromGeoapifyFeature({ name: course.name, lat: course.latitude, lng: course.longitude }, feature);
}

async function overpassOutline(deps: Deps, course: CourseRow): Promise<CourseBounds | null> {
  const body = "data=" + encodeURIComponent(overpassQuery(course.latitude, course.longitude));
  let lastStatus = 0;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await deps.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": WIKI_UA },
        body,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }
      const data = await res.json();
      return pickCourseOutline({ name: course.name, lat: course.latitude, lng: course.longitude }, data?.elements ?? []);
    } catch {
      lastStatus = 0;
    }
  }
  throw new ProviderError(`overpass ${lastStatus || "timeout"}`, lastStatus || 504);
}

/** The course's outline: stored, else Geoapify Place Details (the course's
 * own OSM object, 1 credit) when we have its Geoapify id, else Overpass.
 * A provider failure isn't recorded, so it's tried again later. */
async function resolveOutline(deps: Deps, course: CourseRow, row: ImageryRow): Promise<{ bounds: CourseBounds | null; unresolved: boolean }> {
  const stored = storedOutline(row);
  if (stored || !needsOutlineLookup(row, deps.now())) return { bounds: stored, unresolved: false };
  let bounds: CourseBounds | null = null;
  let source: string | null = null;
  let failed = false;
  const geoKey = deps.env("GEOAPIFY_API_KEY")?.trim();
  if (geoKey && course.geoapify_place_id) {
    if (await deps.store.takeQuota(QUOTA.geoapifyDetails, cap(deps, QUOTA.geoapifyDetails))) {
      try {
        bounds = await geoapifyOutline(deps, geoKey, course);
        if (bounds) source = "geoapify";
      } catch (err) {
        failed = true;
        deps.log?.("course-photos: geoapify outline failed", { courseId: course.id, status: err instanceof ProviderError ? err.status : undefined });
      }
    } else {
      failed = true;
    }
  }
  if (!bounds) {
    if (await deps.store.takeQuota(QUOTA.overpass, cap(deps, QUOTA.overpass))) {
      try {
        bounds = await overpassOutline(deps, course);
        if (bounds) source = "osm";
      } catch (err) {
        failed = true;
        deps.log?.("course-photos: overpass outline failed", { courseId: course.id, status: err instanceof ProviderError ? err.status : undefined });
      }
    } else {
      failed = true;
    }
  }
  if (!bounds && failed) return { bounds: null, unresolved: true };
  const update: ImageryRow = {
    course_id: course.id,
    outline_south: bounds?.south ?? null,
    outline_west: bounds?.west ?? null,
    outline_north: bounds?.north ?? null,
    outline_east: bounds?.east ?? null,
    outline_source: source,
    outline_checked_at: deps.now().toISOString(),
  };
  await deps.store.saveImagery(update);
  Object.assign(row, update);
  return { bounds, unresolved: false };
}

async function resolveOne(deps: Deps, course: CourseRow, row: ImageryRow, size: CoursePhotoSize): Promise<{ photo: CoursePhotoOut | null; unresolved: boolean }> {
  let unresolved = false;
  const key = deps.env("GOOGLE_PLACES_API_KEY")?.trim();
  if (key) {
    try {
      const g = await fromGoogle(deps, key, course, row, size);
      if (g.photo) return g;
      unresolved ||= g.unresolved;
    } catch (err) {
      // A Google error (quota, outage, bad key) never blocks the fallback,
      // and isn't recorded as "no match", so the course is asked again.
      unresolved = true;
      deps.log?.("course-photos: google failed", { courseId: course.id, status: err instanceof ProviderError ? err.status : undefined });
    }
  }
  try {
    const w = await fromWikimedia(deps, course, row, size);
    if (w.photo) return w;
    unresolved ||= w.unresolved;
  } catch (err) {
    unresolved = true;
    deps.log?.("course-photos: wikimedia failed", { courseId: course.id, status: err instanceof ProviderError ? err.status : undefined });
  }
  return { photo: null, unresolved };
}

// ---- The course page's detail: the sharp NAIP picture and the OSM layout ----
//
// Both are slow to make (a cold NAIP render 1.5-20 s, Overpass 10-35 s) and
// identical for every golfer, so they're made once per course here and
// stored: the picture as a JPEG in the public `course-imagery` bucket, the
// layout in course_imagery.layout. The browser then never asks Overpass
// (whose IP-based fair use counts every app user together) or the NAIP
// ImageServer itself; it gets a warm Storage URL / a stored layout.

function storedPicture(deps: Deps, row: ImageryRow): CoursePictureOut | null {
  if (!row.naip_path || !validMercBox(row.naip_bbox) || !row.naip_width || !row.naip_height) return null;
  return { url: deps.store.publicPictureUrl(row.naip_path), bbox: row.naip_bbox, width: row.naip_width, height: row.naip_height };
}

const sameBox = (a: MercBox, b: MercBox) => a.every((v, i) => Math.abs(v - b[i]) < 1);

// A short stable tag of the box + size, so a new outline gives a new object
// path (Storage objects are cached as immutable).
function pictureTag(exp: NaipExport): string {
  let h = 5381;
  for (const ch of `${exp.bbox.join(",")}|${exp.width}x${exp.height}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Fetch the export, hedged: if the first render hasn't answered after
 * NAIP_HEDGE_AFTER_MS, a second request for the same picture (box nudged by
 * 5 cm, so it's a different URL) goes out; the first valid JPEG wins and the
 * other is cancelled. Cold renders are bimodal (~2-6 s or ~12-20 s), so the
 * hedge mostly turns a slow one into a fast one. Each request costs one unit
 * of the daily usgs_export cap. Null when nothing valid came back. */
export async function fetchNaipPicture(deps: Deps, exp: NaipExport): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const overall = setTimeout(() => ctrl.abort(), NAIP_SERVER_TIMEOUT_MS);
  const one = async (url: string): Promise<Uint8Array> => {
    if (!(await deps.store.takeQuota(QUOTA.usgsExport, cap(deps, QUOTA.usgsExport)))) throw new Error("cap");
    const res = await deps.fetch(url, { headers: { "User-Agent": WIKI_UA }, signal: ctrl.signal });
    if (!res.ok) throw new ProviderError(`usgs ${res.status}`, res.status);
    if (!/image\/jpe?g/i.test(res.headers.get("content-type") ?? "")) throw new Error("not a jpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < NAIP_MIN_BYTES || bytes.length > NAIP_MAX_BYTES || !looksLikeJpeg(bytes)) throw new Error("bad picture");
    return bytes;
  };
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = one(exp.url);
    const hedge = new Promise<Uint8Array>((resolve, reject) => {
      const raw = Number(deps.env("COURSE_PHOTOS_NAIP_HEDGE_MS") ?? "");
      const after = Number.isFinite(raw) && raw > 0 ? raw : NAIP_HEDGE_AFTER_MS;
      hedgeTimer = setTimeout(() => one(naipExportUrl(exp.bbox, exp.width, exp.height, 0.05)).then(resolve, reject), after);
      // The first one finishing (either way) before the hedge starts: no hedge.
      first.then(
        () => clearTimeout(hedgeTimer),
        () => {},
      );
    });
    return await Promise.any([first, hedge]);
  } catch {
    return null;
  } finally {
    clearTimeout(overall);
    clearTimeout(hedgeTimer);
    ctrl.abort();
  }
}

async function resolvePicture(deps: Deps, course: CourseRow, row: ImageryRow, bounds: CourseBounds | null): Promise<CoursePictureOut | null> {
  if (!bounds || !isUsCourse(course.latitude, course.longitude)) return null;
  const exp = naipExportFor(bounds, { devicePixelRatio: 2 });
  if (!exp) return null;
  const stored = storedPicture(deps, row);
  if (stored && sameBox(stored.bbox, exp.bbox)) return stored;
  const bytes = await fetchNaipPicture(deps, exp);
  if (!bytes) {
    deps.log?.("course-photos: naip picture failed", { courseId: course.id });
    // An older picture of a previous outline beats none.
    return stored;
  }
  const path = `naip/v1/${course.id}/${exp.width}x${exp.height}-${pictureTag(exp)}.jpg`;
  await deps.store.uploadPicture(path, bytes);
  const update: ImageryRow = { course_id: course.id, naip_path: path, naip_bbox: exp.bbox, naip_width: exp.width, naip_height: exp.height, naip_checked_at: deps.now().toISOString() };
  await deps.store.saveImagery(update);
  Object.assign(row, update);
  return storedPicture(deps, row);
}

/** One Overpass ask for the layout (a FOSSGIS server; identified by
 * User-Agent as its policy asks; only the course's box is sent). */
async function overpassLayout(deps: Deps, endpoint: string, course: CourseRow, bounds: CourseBounds, timeoutMs: number): Promise<OverpassVerdict> {
  try {
    const res = await deps.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": WIKI_UA },
      body: "data=" + encodeURIComponent(layoutOverpassQuery(bounds)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: "invalid", reason: `http ${res.status}` };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { kind: "invalid", reason: "not json" };
    }
    return classifyOverpassAnswer(data, course.name);
  } catch {
    return { kind: "invalid", reason: "network/timeout" };
  }
}

export function storedLayout(row: ImageryRow, now: Date): LayoutAnswer | null {
  if (row.layout_status === "ok" && !stale(row.layout_checked_at, LAYOUT_OK_RECHECK_MS, now)) {
    const a = { status: "ok" as const, layout: row.layout };
    return isLayoutAnswer(a) ? a : null;
  }
  if (row.layout_status === "unmapped" && !stale(row.layout_checked_at, LAYOUT_UNMAPPED_RECHECK_MS, now)) return { status: "unmapped" };
  return null;
}

/** A lookup another request started a moment ago (its marker: a check time
 * with no status yet, see resolveLayout) and that hasn't finished. */
export function layoutPendingElsewhere(row: ImageryRow, now: Date): boolean {
  if (row.layout_status != null || !row.layout_checked_at) return false;
  const at = Date.parse(row.layout_checked_at);
  return Number.isFinite(at) && now.getTime() - at >= -60_000 && now.getTime() - at < LAYOUT_PENDING_MS;
}

// Lookups running in this isolate, per course (a second request for the
// same course joins the first instead of asking Overpass again).
const layoutJobs = new Map<string, Promise<LayoutAnswer | null>>();

function waitMs(deps: Deps, name: string, fallback: number): number {
  const raw = deps.env(name);
  const n = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The lookup itself: up to two asks (askLayoutWithRetry), the result
 * stored; a transient failure stores nothing (and clears our marker). */
async function layoutJob(deps: Deps, course: CourseRow, row: ImageryRow, bounds: CourseBounds, marked: boolean): Promise<LayoutAnswer | null> {
  const { verdict: v, asked } = await askLayoutWithRetry({
    endpoints: LAYOUT_OVERPASS_ENDPOINTS,
    ask: (endpoint, timeoutMs) => overpassLayout(deps, endpoint, course, bounds, timeoutMs),
    budgetMs: waitMs(deps, "COURSE_PHOTOS_LAYOUT_JOB_MS", LAYOUT_JOB_BUDGET_MS),
    // The first ask's unit was taken before the job; a retry takes its own.
    mayAsk: (attempt) => (attempt === 0 ? Promise.resolve(true) : deps.store.takeQuota(QUOTA.overpassLayout, cap(deps, QUOTA.overpassLayout))),
    sleep: deps.sleep,
    random: deps.random,
    clock: deps.clock,
  });
  if (v.kind === "invalid") {
    deps.log?.("course-photos: layout lookup failed", { courseId: course.id, reason: v.reason, asked: asked.map((e) => new URL(e).hostname) });
    if (marked) await deps.store.saveImagery({ course_id: course.id, layout_checked_at: null }).catch(() => {});
    // An older stored layout beats nothing while Overpass is down.
    return row.layout_status === "ok" && isLayoutAnswer({ status: "ok", layout: row.layout }) ? { status: "ok", layout: row.layout as CourseLayout } : null;
  }
  const update: ImageryRow = {
    course_id: course.id,
    layout: v.kind === "ok" ? v.layout : null,
    layout_status: v.kind,
    layout_checked_at: deps.now().toISOString(),
  };
  await deps.store.saveImagery(update);
  Object.assign(row, update);
  return v.kind === "ok" ? { status: "ok", layout: v.layout } : { status: "unmapped" };
}

/** The layout: stored, else an Overpass lookup. Answers within
 * LAYOUT_WAIT_MS; a lookup still running then is "pending" (it carries on
 * in the background and stores its result; the page asks again). A
 * transient failure (error remark, HTTP error, timeout, cap) is never
 * stored: null = "not now". */
async function resolveLayout(deps: Deps, course: CourseRow, row: ImageryRow, bounds: CourseBounds | null): Promise<LayoutAnswer | null | "pending"> {
  const known = storedLayout(row, deps.now());
  if (known) return known;
  let job = layoutJobs.get(course.id);
  if (!job) {
    if (layoutPendingElsewhere(row, deps.now())) return "pending";
    if (!bounds) return null;
    if (!(await deps.store.takeQuota(QUOTA.overpassLayout, cap(deps, QUOTA.overpassLayout)))) return null;
    // First lookup for this course: mark it (a check time, no status: the
    // 20261107190000 shape check allows it, storedLayout ignores it) so a
    // follow-up landing on another isolate says "pending" instead of
    // querying Overpass again. A stale stored layout being re-checked
    // keeps its row untouched.
    let marked = false;
    if (row.layout_status == null) {
      marked = await deps.store.saveImagery({ course_id: course.id, layout_checked_at: deps.now().toISOString() }).then(
        () => true,
        () => false,
      );
    }
    const started = layoutJob(deps, course, row, bounds, marked).catch(() => null);
    job = started.finally(() => layoutJobs.delete(course.id));
    layoutJobs.set(course.id, job);
    deps.background?.(job);
  }
  if (!deps.background) return job;
  const wait = waitMs(deps, "COURSE_PHOTOS_LAYOUT_WAIT_MS", LAYOUT_WAIT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"pending">((r) => {
    timer = setTimeout(() => r("pending"), wait);
  });
  try {
    return await Promise.race([job, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveCoursePhotos(body: unknown, deps: Deps): Promise<CoursePhotosResponse> {
  const b = (body ?? {}) as { courseIds?: unknown; size?: unknown; outlineOnly?: unknown; picture?: unknown; layout?: unknown };
  const wantPicture = b.picture === true;
  const wantLayout = b.layout === true;
  if (wantPicture || wantLayout) return resolveCourseDetail(b.courseIds, wantPicture, wantLayout, deps);
  const ids = cleanCourseIds(b.courseIds);
  const size: CoursePhotoSize = b.size === "hero" ? "hero" : "thumb";
  const outlineOnly = b.outlineOnly === true;
  const photos: CoursePhotosResponse["photos"] = {};
  const bounds: NonNullable<CoursePhotosResponse["bounds"]> = {};
  if (ids.length === 0) return { photos, bounds };

  const [courses, imagery] = await Promise.all([deps.store.courses(ids), deps.store.imagery(ids)]);
  const rows = new Map(imagery.map((r) => [r.course_id, { ...r }]));
  const queue = courses.filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  // Ids that don't exist get an explicit "none" (nothing to retry).
  for (const id of ids) if (!courses.some((c) => c.id === id)) photos[id] = null;

  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const course = queue[next++];
      const row = rows.get(course.id) ?? { course_id: course.id };
      const [p, o] = await Promise.all([
        outlineOnly ? Promise.resolve(null) : resolveOne(deps, course, row, size),
        resolveOutline(deps, course, row).catch(() => ({ bounds: null, unresolved: true })),
      ]);
      if (p && (p.photo || !p.unresolved)) photos[course.id] = p.photo;
      if (o.bounds || !o.unresolved) bounds[course.id] = o.bounds;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return { photos, bounds };
}

/** Course page detail: one course per request (the first valid id), so a
 * caller can't fan out renders or Overpass queries. */
async function resolveCourseDetail(rawIds: unknown, wantPicture: boolean, wantLayout: boolean, deps: Deps): Promise<CoursePhotosResponse> {
  const id = cleanCourseIds(rawIds)[0];
  const out: CoursePhotosResponse = { photos: {}, bounds: {}, ...(wantPicture ? { pictures: {} } : {}), ...(wantLayout ? { layouts: {} } : {}) };
  if (!id) return out;
  const [[course], [stored]] = await Promise.all([deps.store.courses([id]), deps.store.imagery([id])]);
  if (!course || !Number.isFinite(course.latitude) || !Number.isFinite(course.longitude)) {
    if (wantPicture) out.pictures![id] = null;
    return out;
  }
  const row: ImageryRow = { ...(stored ?? {}), course_id: id };
  const o = await resolveOutline(deps, course, row).catch(() => ({ bounds: null, unresolved: true }));
  if (o.bounds || !o.unresolved) out.bounds![id] = o.bounds;
  const [picture, layout] = await Promise.all([
    wantPicture ? resolvePicture(deps, course, row, o.bounds).catch(() => null) : Promise.resolve(undefined),
    wantLayout ? resolveLayout(deps, course, row, o.bounds).catch(() => null) : Promise.resolve(undefined),
  ]);
  if (wantPicture) out.pictures![id] = picture ?? null;
  if (wantLayout && layout === "pending") out.layoutsPending = [id];
  else if (wantLayout && layout && layout !== "pending") out.layouts![id] = layout;
  return out;
}

// ---- HTTP ----

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

export async function handleRequest(req: Request, deps: Deps & { authenticate: (req: Request) => Promise<boolean> }): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Signed-in golfers only (the anon key alone also passes the gateway's
  // JWT check, so the user is checked here).
  if (!(await deps.authenticate(req))) return json({ error: "Not authenticated." }, 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  try {
    return json(await resolveCoursePhotos(body, deps));
  } catch (err) {
    deps.log?.("course-photos: failed", { message: err instanceof Error ? err.message : String(err) });
    return json({ error: "Couldn't load course photos." }, 500);
  }
}
