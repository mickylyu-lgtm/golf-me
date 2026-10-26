import { useEffect, useState, useSyncExternalStore } from "react";
import { articleMatchesCourse, commonsFileMatchesCourse, isCommonsUrl, plainArtist } from "./coursePhotoMatch";

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

const CACHE_PREFIX = "golfme:coursePhoto:v1:";
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

async function fromWikipedia(name: string, lat: number, lng: number): Promise<string | null> {
  const data = await getJson("https://en.wikipedia.org/w/api.php", {
    action: "query",
    generator: "search",
    gsrsearch: `golf nearcoord:2km,${lat},${lng}`,
    gsrlimit: "8",
    prop: "pageimages",
    piprop: "original|name",
  });
  const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of pages) {
    if (!p.pageimage || !p.original?.source || !isCommonsUrl(p.original.source)) continue;
    if (articleMatchesCourse(name, p.title, p.pageimage)) return `File:${p.pageimage}`;
  }
  return null;
}

async function fromCommonsGeotags(name: string, lat: number, lng: number): Promise<string | null> {
  const data = await getJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lng}`,
    gsradius: String(COMMONS_RADIUS_M),
    gsnamespace: "6",
    gslimit: "200",
  });
  const hit = (data?.query?.geosearch ?? []).find((f: any) => /\.(jpe?g|png|webp)$/i.test(f.title) && commonsFileMatchesCourse(name, f.title));
  return hit?.title ?? null;
}

async function describeFile(fileTitle: string): Promise<CoursePhoto | null> {
  const data = await getJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(HERO_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  const page = Object.values<any>(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  const url: string | undefined = info?.thumburl ?? info?.url;
  if (!url || !isCommonsUrl(url)) return null;
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
      const file = (await fromWikipedia(name, lat, lng).catch(() => null)) ?? (await fromCommonsGeotags(name, lat, lng));
      const photo = file ? await describeFile(file) : null;
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

/** The course's Wikimedia photo, or null (none, still looking, or disabled). */
export function useCoursePhoto(name: string | undefined, lat: number | undefined, lng: number | undefined, enabled = true): CoursePhoto | null {
  const [photo, setPhoto] = useState<CoursePhoto | null>(null);
  useEffect(() => {
    setPhoto(null);
    if (!enabled || !name || lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let cancelled = false;
    void lookupCoursePhoto(name, lat, lng).then((p) => !cancelled && setPhoto(p));
    return () => {
      cancelled = true;
    };
  }, [name, lat, lng, enabled]);
  return photo;
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
