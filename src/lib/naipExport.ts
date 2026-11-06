// One sharp aerial picture of a course from the USGS NAIP Plus ImageServer
// (Micky, 2026-11-06: "even more detailed"). The cached USGS tiles stop at
// z16 (~1.8 m per pixel in NYC); the underlying NAIP/HRO mosaic is 0.3-0.6 m.
// ImageServer `exportImage` renders any box at any size up to 4000 px, so a
// course page asks for ONE picture of the course's outline box, sized to the
// screen, and lays it over the z16 tiles (MapLibre image source in the
// overview, an <img> in the still view). Never in lists.
//
// Public domain (USGS/USDA, "USGS The National Map: Orthoimagery", the same
// credit the tiles carry), no key, CORS open. Measured 2026-11-06: a cold
// render takes 11-44 s, a repeat of the exact same URL ~0.1 s (CloudFront,
// max-age 12 h; the browser caches it too). So the URL is deterministic per
// course and screen class, the tiles always show first, and the picture is
// laid over them when it arrives (instantly within 3 s, faded in after).
// Pure (no DOM), so node tests cover it (tests/naipExport.test.ts).
import type { CourseBounds } from "../../supabase/functions/_shared/courseBounds.ts";

export const NAIP_EXPORT_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage";
/** The service's own limit (maxImageWidth/Height). */
export const NAIP_MAX_PX = 4000;
/** Finest pixel worth asking for (the mosaic's best is 0.3 m). */
export const NAIP_NATIVE_M = 0.3;
/** Padding around the outline (fraction of its span, each side): the tilted,
 * circling camera sees past the outline. */
export const NAIP_PAD = 0.15;
/** Arrived within this: shown as if it had always been there. */
export const NAIP_FAST_MS = 3000;
/** Still not here: stop waiting (the tiles stay). */
export const NAIP_GIVE_UP_MS = 60_000;

const R = 6378137;
const MAX_LAT = 85.05112878;

export function lngLatToMerc(lng: number, lat: number): [number, number] {
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360))];
}

export function mercToLngLat(x: number, y: number): [number, number] {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

/** Longest side of the picture for this screen: enough for a retina phone
 * to pinch in a little, within what a phone GPU and the service handle. */
export function naipMaxPxFor(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio >= 2 ? 2048 : 1024;
}

export interface NaipExport {
  url: string;
  width: number;
  height: number;
  /** Web-Mercator box actually asked for (same aspect as width x height). */
  bbox: [number, number, number, number];
  /** MapLibre image-source corners: top-left, top-right, bottom-right,
   * bottom-left, [lng, lat]. */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  /** Ground metres per pixel of the picture. */
  metersPerPixel: number;
}

const fmt = (v: number) => v.toFixed(1);

/** The one export request for a course outline. Null for a missing or
 * degenerate box. The box is grown on its short side so its aspect matches
 * the pixel size exactly (the server would otherwise pad it its own way and
 * the picture would sit off its corners). */
export function naipExportFor(bounds: CourseBounds | null | undefined, opts: { devicePixelRatio?: number; pad?: number } = {}): NaipExport | null {
  if (!bounds) return null;
  const { south, west, north, east } = bounds;
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) return null;
  const pad = opts.pad ?? NAIP_PAD;
  const [x0, y0] = lngLatToMerc(west, south);
  const [x1, y1] = lngLatToMerc(east, north);
  const px = (x1 - x0) * pad;
  const py = (y1 - y0) * pad;
  let bx0 = x0 - px, bx1 = x1 + px, by0 = y0 - py, by1 = y1 + py;
  const dx = bx1 - bx0;
  const dy = by1 - by0;
  // Mercator metres are stretched by 1/cos(lat); ground metres decide detail.
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const longGround = Math.max(dx, dy) * k;
  const maxPx = Math.min(NAIP_MAX_PX, naipMaxPxFor(opts.devicePixelRatio ?? 1));
  const longPx = Math.max(256, Math.min(maxPx, Math.ceil(longGround / NAIP_NATIVE_M)));
  let width: number, height: number;
  if (dx >= dy) {
    width = longPx;
    height = Math.max(64, Math.round((longPx * dy) / dx));
    const h = (dx * height) / width;
    const cy = (by0 + by1) / 2;
    by0 = cy - h / 2;
    by1 = cy + h / 2;
  } else {
    height = longPx;
    width = Math.max(64, Math.round((longPx * dx) / dy));
    const w = (dy * width) / height;
    const cx = (bx0 + bx1) / 2;
    bx0 = cx - w / 2;
    bx1 = cx + w / 2;
  }
  const bbox: [number, number, number, number] = [bx0, by0, bx1, by1].map((v) => Math.round(v * 10) / 10) as [number, number, number, number];
  const [w, s] = mercToLngLat(bbox[0], bbox[1]);
  const [e, n] = mercToLngLat(bbox[2], bbox[3]);
  const params = [
    `bbox=${bbox.map(fmt).join(",")}`,
    "bboxSR=3857",
    "imageSR=3857",
    `size=${width},${height}`,
    "format=jpg",
    "compressionQuality=80",
    "interpolation=RSP_BilinearInterpolation",
    "f=image",
  ];
  return {
    url: `${NAIP_EXPORT_URL}?${params.join("&")}`,
    width,
    height,
    bbox,
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
    metersPerPixel: ((bbox[2] - bbox[0]) * k) / width,
  };
}

export type DetailReveal = "now" | "fade" | "drop";

/** What to do with the picture once it has loaded, by how long it took. */
export function detailReveal(elapsedMs: number): DetailReveal {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "drop";
  if (elapsedMs <= NAIP_FAST_MS) return "now";
  return elapsedMs <= NAIP_GIVE_UP_MS ? "fade" : "drop";
}

/** Where the picture sits inside a flat still view (SatelliteTiles) centred
 * on lat/lng at a fractional tile (256 px) zoom, in CSS px. */
export function imageRectInView(
  view: { lat: number; lng: number; zoom: number; width: number; height: number },
  bbox: [number, number, number, number],
): { left: number; top: number; width: number; height: number } {
  const world = 256 * 2 ** view.zoom;
  const toPx = (x: number, y: number) => [((x + Math.PI * R) / (2 * Math.PI * R)) * world, ((Math.PI * R - y) / (2 * Math.PI * R)) * world];
  const [cx, cy] = toPx(...lngLatToMerc(view.lng, view.lat));
  const [lx, ty] = toPx(bbox[0], bbox[3]);
  const [rx, by] = toPx(bbox[2], bbox[1]);
  return { left: lx - (cx - view.width / 2), top: ty - (cy - view.height / 2), width: rx - lx, height: by - ty };
}
