// The course page's "drone" overview: a tilted satellite view that slowly
// circles the course. Pure (no MapLibre, no DOM) so the motion rules are
// tested under node (tests/droneOrbit.test.ts); CourseOverviewMap drives
// MapLibre with them.

// One full circle a minute: slow enough to read the holes, fast enough to
// look alive.
export const ORBIT_DEG_PER_SEC = 6;
// 45, not 60 (Micky, 2026-11-06: "make the drone shot clearer"): a steeper
// tilt stretches the near ground across more pixels and fills the far half
// with lower-zoom tiles, both of which read as blur on NAIP imagery.
export const OVERVIEW_PITCH = 45;

// ---- Zoom units ----
// Two conventions meet here. courseBounds' fitZoom, the tile sources'
// maxZoom and SatelliteTiles use 256 px tiles ("tile zoom": z16 = a USGS
// z16 tile drawn 256 CSS px wide). MapLibre's zoom is one less for the same
// scale (its world is 512 px at zoom 0). The overview used to hand the tile
// zoom straight to MapLibre, so it sat a whole zoom level closer than its
// framing meant: Forest Park ended up at tile zoom ~16.7, z16 NAIP scaled up
// 1.6x (3-5x on a retina screen).

/** MapLibre zoom for a tile (256 px) zoom. */
export function maplibreZoom(tileZoom: number): number {
  return tileZoom - 1;
}

// How far past the source's deepest tiles the camera may go (tile zoom):
// 0.3 = tiles drawn at most 1.23x their size. USGS NAIP stops at 16, so its
// overview never goes past 16.3; MapTiler (19) keeps the old 17.5 limit.
export const OVERZOOM_ALLOWANCE = 0.3;
const OVERVIEW_MAX_TILE_ZOOM = 17.5;

/** Deepest tile zoom the overview camera may use for this source. */
export function overviewZoomCap(sourceMaxZoom: number): number {
  const max = Number.isFinite(sourceMaxZoom) ? sourceMaxZoom : 16;
  return Math.min(OVERVIEW_MAX_TILE_ZOOM, max + OVERZOOM_ALLOWANCE);
}

// With the sharp NAIP picture on (drone v2), the tiles' 16.3 is far short of
// what the picture holds (Micky, 2026-11-07: "it's not letting me zoom in as
// much"; before 6c5233b the overview allowed MapLibre 18.5 = tile zoom 19.5,
// z16 tiles blown up 11x). The camera may then go to where one picture pixel
// is PICTURE_OVERZOOM zoom past one CSS pixel (0.5 = drawn at most 1.41x,
// close to the tiles' own 1.23x; 0.75 looked soft on a 3x screen). The
// picture itself is never finer than the mosaic's 0.3 m (naipExport), so
// this also stops at the NAIP detail limit; never below the tiles' cap.
export const PICTURE_OVERZOOM = 0.5;
export const PICTURE_MAX_TILE_ZOOM = 19.5;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;

/** Deepest tile zoom while the picture (a Web-Mercator box `widthPx` px
 * wide) shows; the tiles' cap when the box is unusable. */
export function pictureZoomCap(bbox: readonly number[], widthPx: number, sourceMaxZoom: number): number {
  const tiles = overviewZoomCap(sourceMaxZoom);
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite) || !(widthPx > 0)) return tiles;
  const mercPerPx = (bbox[2] - bbox[0]) / widthPx;
  if (!(mercPerPx > 0)) return tiles;
  // One picture pixel = one CSS pixel at this tile zoom.
  const native = Math.log2(EARTH_CIRCUMFERENCE_M / (256 * mercPerPx));
  return Math.max(tiles, Math.min(native + PICTURE_OVERZOOM, PICTURE_MAX_TILE_ZOOM));
}

/** The raster source's tileSize. On a retina screen USGS tiles are declared
 * 128 px, so MapLibre asks for the next zoom up and draws each 256 px tile
 * at the screen's own density instead of scaling it 2x (up to z16, where
 * NAIP stops). MapTiler stays at 256: it bills per tile and is sharp
 * already. */
export function overviewTileSize(sourceId: string, devicePixelRatio: number): 128 | 256 {
  return sourceId === "usgs" && Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1.5 ? 128 : 256;
}
// The still view under reduced motion: same tilt, a fixed heading.
export const STILL_BEARING = 30;
// After the golfer drags/pinches, the orbit waits this long before it
// carries on from wherever they left the camera.
export const ORBIT_RESUME_AFTER_MS = 8000;
// A frame after a long gap (tab in background, a stall) never jumps the
// camera by more than this much time.
const MAX_FRAME_DT_MS = 100;

export function normalizeBearing(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

/** Bearing after `elapsedMs` of continuous orbit from `start`. */
export function orbitBearing(start: number, elapsedMs: number, degPerSec = ORBIT_DEG_PER_SEC): number {
  return normalizeBearing(start + (Math.max(0, elapsedMs) / 1000) * degPerSec);
}

/** One animation frame: the next bearing given the time since the last
 * frame (clamped, so a stall never makes the camera leap). */
export function orbitStep(bearing: number, dtMs: number, degPerSec = ORBIT_DEG_PER_SEC): number {
  const dt = Number.isFinite(dtMs) ? Math.min(Math.max(dtMs, 0), MAX_FRAME_DT_MS) : 0;
  return orbitBearing(bearing, dt, degPerSec);
}

export type OverviewMotion = "orbit" | "still";

/** Reduced motion gets a still, tilted view; everyone else the orbit. */
export function overviewMotion(prefersReducedMotion: boolean): OverviewMotion {
  return prefersReducedMotion ? "still" : "orbit";
}

export interface OrbitConditions {
  motion: OverviewMotion;
  /** The map box is on screen. */
  inView: boolean;
  /** The page/app is in the foreground. */
  pageVisible: boolean;
  /** A finger or the mouse is on the map right now. */
  interacting: boolean;
  /** When the golfer last touched the map (ms), or null. */
  lastInteractionAt: number | null;
  now: number;
}

/** Should the camera be orbiting on this frame? */
export function orbitRunning(c: OrbitConditions): boolean {
  if (c.motion !== "orbit" || !c.inView || !c.pageVisible || c.interacting) return false;
  if (c.lastInteractionAt != null && c.now - c.lastInteractionAt < ORBIT_RESUME_AFTER_MS) return false;
  return true;
}
