// Satellite image of any course from its coordinates (Micky, 2026-10-23:
// every nearby course should open a page with at least an image). Mapbox
// Static Images API, satellite-v9 style (imagery only, no labels).
//
// VITE_MAPBOX_TOKEN is a Mapbox *public* token (pk.*), safe in the bundle by
// design and URL-restricted to GolfMe's domains in the Mapbox dashboard.
// Never put a secret (sk.*) token here. Unset -> null, and callers fall back
// to CourseHero's generic illustration.
//
// Mapbox's terms require its logo and attribution. The hero image keeps
// both drawn into the picture (the API default). List thumbnails are too
// small for either to be legible, so they're drawn without, and the list
// shows SatelliteAttribution (text + Mapbox wordmark link) right under the
// rows instead. Images are only ever hotlinked, never cached or stored by
// GolfMe.

import { OSM_CREDIT, maptilerSource, tileSourceFor, type TileSource } from "./satelliteTiles";

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || undefined;

// 2026-11-05 (option A, $0): aerial tiles for thumbnails, still views and
// the drone overview come from USGS NAIP for US courses (no key). MapTiler
// is optional (option C): with VITE_MAPTILER_KEY set it's used everywhere.
// A publishable key (it appears in tile URLs by design), restricted to
// golfme.app + localhost in the MapTiler dashboard. Outside the US without
// the key: thumbnails use the Mapbox image above (when its
// token is set) or the pin.
const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined)?.trim() || undefined;

export function maptilerKey(): string | undefined {
  return MAPTILER_KEY;
}

/** The course's aerial imagery source (see lib/satelliteTiles.ts): MapTiler
 * when its key is set, else USGS NAIP for US courses, else null. */
// One object for the app's lifetime: views depend on the source's identity
// (a new object per render would rebuild the overview map every render).
const MAPTILER_SOURCE = MAPTILER_KEY ? maptilerSource(MAPTILER_KEY) : null;

export function courseTileSource(course: { lat?: number; lng?: number; country?: string | null }): TileSource | null {
  return MAPTILER_SOURCE ?? tileSourceFor(course);
}

/** Credit line for aerial imagery (+ OSM, for the course outlines that
 * frame it and MapTiler's own requirement). */
export function aerialCredit(source: TileSource): string {
  return `${source.credit} · ${OSM_CREDIT}`;
}

// ~1.5 km across at the hero's width: a typical 18-hole course plus a
// little of its surroundings.
const HERO_ZOOM = 15;
// List-row thumbnails are tiny, so a wider view (~700 m across) reads as
// "a golf course" rather than a patch of fairway.
const THUMB_ZOOM = 14;

/** Some satellite source is configured (MapTiler tiles or Mapbox). */
// Aerial imagery can always show now (USGS needs no key), so lists always
// carry its credit line.
export function satelliteImageryEnabled(): boolean {
  return true;
}

export function mapboxEnabled(): boolean {
  return Boolean(TOKEN);
}

export function courseSatelliteImageUrl(lat: number | undefined, lng: number | undefined): string | null {
  if (!TOKEN || lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const center = `${lng.toFixed(5)},${lat.toFixed(5)},${HERO_ZOOM},0`;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center}/640x360@2x?access_token=${encodeURIComponent(TOKEN)}`;
}

export function courseSatelliteThumbUrl(lat: number | undefined, lng: number | undefined): string | null {
  if (!TOKEN || lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const center = `${lng.toFixed(5)},${lat.toFixed(5)},${THUMB_ZOOM},0`;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center}/112x112@2x?attribution=false&logo=false&access_token=${encodeURIComponent(TOKEN)}`;
}
