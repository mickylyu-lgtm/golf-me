import { useSyncExternalStore } from "react";
import {
  articleMatchesCourse,
  classifyCommonsLicense,
  commonsFileMatchesCourse,
  isCommonsUrl,
  photoCourseScore,
  photoShowsCourse,
  plainArtist,
} from "./coursePhotoMatch";

// 2026-11-05: real courses now get their photo server-side (course-photos
// Edge Function: Google Places, then the same Wikimedia lookup with a
// license check; see courseImageryClient.ts). This browser lookup is kept
// for demo courses (no course id) and as the fallback while course-photos
// isn't deployed.
//
// A real photo of a course from Wikimedia (Micky, 2026-10-25: show what a
// course looks like, with a switch to the satellite view for every course).
// Free and freely licensed, but only some courses have one; the rest keep
// their satellite view. Never a generated image.
//
// Two lookups, both public APIs called straight from the browser (no key):
//   1. Wikipedia articles near the course whose title names it and whose
//      lead image is a Commons file (articleMatchesCourse),
//   2. geotagged Commons photos within 600 m whose file name says golf
//      (commonsFileMatchesCourse).
// The chosen file's author and license come from Commons and are shown as
// the photo credit. Results (including "no photo") are kept per course in
// localStorage so a list doesn't ask again on every visit. Images are
// hotlinked from upload.wikimedia.org, never stored by GolfMe.

export interface CoursePhoto {
  url: string;
  /** A small copy for list thumbnails. */
  thumbUrl: string;
  /** Plain-text credit, e.g. "Jim Henderson, CC0 / Wikimedia Commons". */
  credit: string;
  /** The file's Commons page (author, license and full-size image). */
  pageUrl: string;
}

// v2 (2026-11-05): photos must show the course itself; v1 answers chosen
// under the older, looser rules are looked up again.
const CACHE_PREFIX = "golfme:coursePhoto:v2:";
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Commons serves thumbnails in fixed width steps (500, 960, ...): 960 for
// the course page hero, 250 for list rows.
const HERO_WIDTH = 960;
const THUMB_WIDTH = 250;
const COMMONS_RADIUS_M = 600;

function cacheKey(name: string, lat: number, lng: number) {
  return `${CACHE_PREFIX}${name.toLowerCase()}@${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function readCache(key: string): CoursePhoto | null | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const { at, photo } = JSON.parse(raw) as { at: number; photo: CoursePhoto | null };
    if (Date.now() - at > (photo ? FOUND_TTL_MS : NONE_TTL_MS)) return undefined;
    return photo;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, photo: CoursePhoto | null) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), photo }));
  } catch {
    // Private mode / full storage: we just look it up again next time.
  }
}

async function getJson(url: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Same rules as the course-photos Edge Function (shared in
// supabase/functions/_shared/coursePhotoMatch.ts): a Wikipedia article near
// the course naming it, then geotagged Commons photos by the course, the
// most course-like titles first; a candidate is used only if its title,
// description and categories show the course itself (holes, fairways,
// greens, an aerial), never a logo, sign, map, clubhouse or car park.
async function fromWikipedia(name: string, lat: number, lng: number): Promise<string[]> {
  const data = await getJson("https://en.wikipedia.org/w/api.php", {
    action: "query",
    generator: "search",
    gsrsearch: `golf nearcoord:2km,${lat},${lng}`,
    gsrlimit: "8",
    prop: "pageimages",
    piprop: "original|name",
  });
  const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .filter((p) => p.pageimage && p.original?.source && isCommonsUrl(p.original.source) && articleMatchesCourse(name, p.title, p.pageimage))
    .filter((p) => photoCourseScore({ title: p.pageimage }) >= 0)
    .map((p) => `File:${p.pageimage}`);
}

async function fromCommonsGeotags(name: string, lat: number, lng: number): Promise<string[]> {
  const data = await getJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lng}`,
    gsradius: String(COMMONS_RADIUS_M),
    gsnamespace: "6",
    gslimit: "200",
  });
  return (data?.query?.geosearch ?? [])
    .map((f: any) => String(f.title))
    .filter((t: string) => commonsFileMatchesCourse(name, t))
    .map((t: string) => ({ t, score: photoCourseScore({ title: t }) }))
    .filter((x: { score: number }) => x.score >= 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .map((x: { t: string }) => x.t);
}

const MAX_DESCRIBES = 4;

async function describeFile(fileTitle: string): Promise<CoursePhoto | null> {
  const data = await getJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(HERO_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|ImageDescription|Categories",
  });
  const page = Object.values<any>(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  const url: string | undefined = info?.thumburl ?? info?.url;
  if (!url || !isCommonsUrl(url)) return null;
  if (!photoShowsCourse({ title: fileTitle, description: info.extmetadata?.ImageDescription?.value, categories: info.extmetadata?.Categories?.value })) return null;
  if (!classifyCommonsLicense(info.extmetadata?.LicenseShortName?.value)) return null;
  const artist = plainArtist(info.extmetadata?.Artist?.value);
  const license: string | undefined = info.extmetadata?.LicenseShortName?.value;
  const thumbUrl = url.replace(`/${HERO_WIDTH}px-`, `/${THUMB_WIDTH}px-`);
  return {
    url,
    thumbUrl,
    credit: [artist, license].filter(Boolean).join(", ") + " / Wikimedia Commons",
    pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`,
  };
}

const inflight = new Map<string, Promise<CoursePhoto | null>>();

export function lookupCoursePhoto(name: string, lat: number, lng: number): Promise<CoursePhoto | null> {
  const key = cacheKey(name, lat, lng);
  const cached = readCache(key);
  if (cached !== undefined) return Promise.resolve(cached);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const lead = await fromWikipedia(name, lat, lng).catch(() => [] as string[]);
      const geotagged = await fromCommonsGeotags(name, lat, lng);
      let photo: CoursePhoto | null = null;
      for (const file of [...new Set([...lead, ...geotagged])].slice(0, MAX_DESCRIBES)) {
        photo = await describeFile(file);
        if (photo) break;
      }
      writeCache(key, photo);
      return photo;
    })()
      // A network failure isn't cached: the row shows satellite this time
      // and tries again next visit.
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

// The golfer's "Photo | Satellite" choice, shared by every course list and
// page and remembered on this device.
export type CourseImageMode = "photo" | "satellite";
const MODE_KEY = "golfme:courseImageMode";
const listeners = new Set<() => void>();

function readMode(): CourseImageMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "satellite" ? "satellite" : "photo";
  } catch {
    return "photo";
  }
}

let mode: CourseImageMode | undefined;

export function setCourseImageMode(next: CourseImageMode) {
  mode = next;
  try {
    window.localStorage.setItem(MODE_KEY, next);
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((l) => l());
}

export function useCourseImageMode(): CourseImageMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (mode ??= readMode()),
  );
}
