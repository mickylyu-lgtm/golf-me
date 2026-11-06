// Aerial imagery without a live map. Pure (no React, no import.meta) so
// tests/courseImagery.test.ts runs under node.
//
// Sources (Micky, 2026-11-05, option A: $0):
//   * USGS NAIP orthoimagery (The National Map, USGSImageryOnly), the
//     default for US courses: public domain, no key, no cost. Cached tiles
//     go to z16 only (404 above), so closer views scale z16 tiles up (at
//     most 1.4x in thumbnails, 1.23x in the drone overview).
//     Attribution requested by USGS: "USGS The National Map: Orthoimagery".
//   * MapTiler satellite, only when VITE_MAPTILER_KEY is set (option C):
//     then it's used everywhere (sharper, worldwide). A publishable key,
//     restricted to GolfMe's domains in the MapTiler dashboard.
//   * Neither (a course outside the US, no key): no imagery; the caller
//     keeps its placeholder.
// A thumbnail is a few raster tiles laid out as plain <img>s: one request
// per tile (1-4 per thumbnail), no map session.

export type TileSourceId = "usgs" | "maptiler";

export interface TileSource {
  id: TileSourceId;
  /** Deepest zoom the source serves; closer views scale these tiles up. */
  maxZoom: number;
  /** {z}/{x}/{y} template for a MapLibre raster source. */
  template: string;
  url(z: number, x: number, y: number): string;
  /** Plain-text credit to show wherever the imagery shows. */
  credit: string;
  /** The same credit as HTML links (MapLibre attribution control). */
  creditHtml: string;
}

const USGS_BASE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile";
export const USGS_MAX_ZOOM = 16;

export const USGS_SOURCE: TileSource = {
  id: "usgs",
  maxZoom: USGS_MAX_ZOOM,
  // ArcGIS tile order is {z}/{y}/{x} (row before column).
  template: `${USGS_BASE}/{z}/{y}/{x}`,
  url: (z, x, y) => `${USGS_BASE}/${z}/${y}/${x}`,
  credit: "USGS The National Map: Orthoimagery",
  creditHtml: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map: Orthoimagery</a>',
};

export function maptilerSource(key: string): TileSource {
  return {
    id: "maptiler",
    maxZoom: 19,
    template: maptilerTileTemplate(key),
    url: (z, x, y) => maptilerTileUrl(key, z, x, y),
    credit: "© MapTiler",
    creditHtml: '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a>',
  };
}

export const OSM_CREDIT = "© OpenStreetMap contributors";
export const OSM_CREDIT_HTML = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

// "Is this course in the US?" (where NAIP exists). The course's country,
// when we have it (real courses: Geoapify's country, stored in
// public.courses), decides. Without it (demo fixtures, old rows) a coarse
// box test: the contiguous US, Alaska, Hawaii, Puerto Rico + USVI, Guam +
// the Northern Marianas, American Samoa. The contiguous box also takes in
// the strip of Canada south of 49°N and a sliver of northern Mexico; a
// course there gets no NAIP tiles (they 404), the image fails to load and
// the view falls back to its placeholder, so a wrong guess costs nothing.
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

/** Where a course's aerial imagery comes from: MapTiler everywhere when its
 * key is set, else USGS NAIP for US courses, else none. */
export function tileSourceFor(course: { lat?: number; lng?: number; country?: string | null }, maptilerKeyValue?: string): TileSource | null {
  if (maptilerKeyValue) return maptilerSource(maptilerKeyValue);
  return isUsCourse(course.lat, course.lng, course.country) ? USGS_SOURCE : null;
}

// Rate safety (USGS publishes no limit; be a polite client). Tiles are only
// drawn for thumbnails that are on screen (lazy <img>s) and the browser
// caches them normally. On top, this caps how many DIFFERENT tile URLs the
// thumbnails and still views may start per minute: a repeat of a URL is
// free (the browser cache answers it). A list of 10 courses needs at most
// ~40; the cap only bites on something pathological (a storm of re-renders,
// a bug), and a refused view just keeps its placeholder.
export const TILE_BUDGET_PER_MINUTE = 150;

export class TileBudget {
  private seen = new Map<string, number>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit = TILE_BUDGET_PER_MINUTE, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** May these tiles be requested now? All-or-nothing per view. */
  take(urls: string[], now = Date.now()): boolean {
    for (const [u, at] of this.seen) if (now - at > this.windowMs) this.seen.delete(u);
    const fresh = [...new Set(urls)].filter((u) => !this.seen.has(u));
    if (this.seen.size + fresh.length > this.limit) return false;
    for (const u of fresh) this.seen.set(u, now);
    return true;
  }
}

export const MAPTILER_TILESET = "satellite-v4";

export function maptilerTileUrl(key: string, z: number, x: number, y: number): string {
  return `https://api.maptiler.com/tiles/${MAPTILER_TILESET}/${z}/${x}/${y}?key=${encodeURIComponent(key)}`;
}

/** Template for a MapLibre raster source. */
export function maptilerTileTemplate(key: string): string {
  return `https://api.maptiler.com/tiles/${MAPTILER_TILESET}/{z}/{x}/{y}?key=${encodeURIComponent(key)}`;
}

/** Web-Mercator tile coordinates of a point (fractional). */
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

export interface MosaicTile {
  z: number;
  x: number;
  y: number;
  /** Position of the tile's top-left corner inside the view, in CSS px. */
  left: number;
  top: number;
}

/** The tiles that cover a `width` x `height` view centred on the point,
 * each drawn `tilePx` CSS px wide. Off-world rows are skipped; columns wrap
 * around the antimeridian. */
export function tileMosaic(opts: { lat: number; lng: number; zoom: number; width: number; height: number; tilePx: number }): MosaicTile[] {
  const { lat, lng, zoom, width, height, tilePx } = opts;
  if (![lat, lng, zoom, width, height, tilePx].every(Number.isFinite) || width <= 0 || height <= 0 || tilePx <= 0) return [];
  const z = Math.max(0, Math.min(22, Math.round(zoom)));
  const n = 2 ** z;
  const { x: fx, y: fy } = lngLatToTile(lng, lat, z);
  const px = fx * tilePx;
  const py = fy * tilePx;
  const x0 = px - width / 2;
  const y0 = py - height / 2;
  const firstCol = Math.floor(x0 / tilePx);
  const lastCol = Math.floor((x0 + width - 1e-9) / tilePx);
  const firstRow = Math.floor(y0 / tilePx);
  const lastRow = Math.floor((y0 + height - 1e-9) / tilePx);
  const tiles: MosaicTile[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    if (row < 0 || row >= n) continue;
    for (let col = firstCol; col <= lastCol; col++) {
      tiles.push({ z, x: ((col % n) + n) % n, y: row, left: col * tilePx - x0, top: row * tilePx - y0 });
    }
  }
  return tiles;
}

// Highest tile zoom asked for; closer views scale these tiles up.
export const MAX_TILE_ZOOM = 18;

// Past the source's deepest zoom, tiles are drawn at most this much larger
// than their own size (USGS z16 -> at most 358 px wide). A view framed
// closer than that shows a little more ground around the course instead of
// blurrier tiles.
export const MAX_TILE_UPSCALE = 1.4;

/** A fractional view zoom as whole-zoom tiles drawn larger or smaller:
 * zoom 15.6 -> z15 tiles drawn 256 * 2^0.6 = 388 px wide. Beyond `maxZ` the
 * zoom is held at maxZ + log2(MAX_TILE_UPSCALE). */
export function tileZoomFor(zoom: number, maxZ = MAX_TILE_ZOOM): { z: number; tilePx: number } {
  const zc = Math.min(Number.isFinite(zoom) ? Math.max(0, zoom) : 0, maxZ + Math.log2(MAX_TILE_UPSCALE));
  const z = Math.min(maxZ, Math.floor(zc));
  return { z, tilePx: 256 * 2 ** (zc - z) };
}
