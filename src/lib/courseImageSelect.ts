// Which picture a course shows, in one place. Pure, so the priority rules
// are tested under node (tests/courseImagery.test.ts).
//
// Micky, 2026-11-05: a real photo of that specific course first, satellite
// only as the last resort. On the course page the "drone" overview (tilted,
// orbiting satellite, framed on the course outline) leads.

export type PhotoSource = "handpicked" | "google" | "wikimedia";

export type ThumbSource =
  | { kind: "photo"; url: string; source: PhotoSource }
  | { kind: "tiles" }
  | { kind: "static"; url: string }
  | { kind: "none" };

export interface ThumbInput {
  /** The golfer's "Photo | Satellite" choice. */
  mode: "photo" | "satellite";
  /** A hand-verified photo (SUPPORTED_TEE_TIME_COURSES). */
  handpickedUrl?: string;
  /** The best real photo found (Google Places, else Wikimedia). */
  photo?: { url: string; source: PhotoSource } | null;
  /** Aerial tiles can be drawn (a source for this course: USGS NAIP in the
   * US, MapTiler when keyed; coordinates known). */
  tilesAvailable: boolean;
  /** The older Mapbox static satellite image, when its token is set. */
  staticUrl?: string | null;
  /** Images that already failed to load ("tiles" for the tile mosaic). */
  failed: ReadonlySet<string>;
}

export const TILES_FAILED_KEY = "tiles";

export function chooseThumbSource(input: ThumbInput): ThumbSource {
  const ok = (url: string | undefined | null): url is string => Boolean(url) && !input.failed.has(url as string);
  if (input.mode === "photo") {
    if (ok(input.handpickedUrl)) return { kind: "photo", url: input.handpickedUrl, source: "handpicked" };
    if (input.photo && ok(input.photo.url)) return { kind: "photo", url: input.photo.url, source: input.photo.source };
  }
  if (input.tilesAvailable && !input.failed.has(TILES_FAILED_KEY)) return { kind: "tiles" };
  if (ok(input.staticUrl)) return { kind: "static", url: input.staticUrl };
  return { kind: "none" };
}

export type MediaTab = "overview" | "photo" | "satellite";

export interface MediaTabInput {
  /** The live overview can run (an aerial source, coordinates, WebGL). */
  overviewAvailable: boolean;
  hasPhoto: boolean;
  /** A still satellite image can be drawn (tiles or the Mapbox image). */
  hasStaticSatellite: boolean;
}

/** The course page's views, in the order their switch lists them. The still
 * satellite view only stands in when the live overview can't run. */
export function courseMediaTabs(input: MediaTabInput): MediaTab[] {
  const tabs: MediaTab[] = [];
  if (input.overviewAvailable) tabs.push("overview");
  if (input.hasPhoto) tabs.push("photo");
  if (!input.overviewAvailable && input.hasStaticSatellite) tabs.push("satellite");
  return tabs;
}

/** The view to show: the golfer's own pick while it's still offered,
 * otherwise the first one (overview, then photo). */
export function pickCourseMediaTab(tabs: MediaTab[], chosen: MediaTab | null): MediaTab | null {
  if (chosen && tabs.includes(chosen)) return chosen;
  return tabs[0] ?? null;
}

/** The live overview needs an aerial source for the course (USGS NAIP in
 * the US, or MapTiler when keyed), its coordinates and WebGL. */
export function overviewAvailable(opts: { hasSource: boolean; hasCoords: boolean; webgl: boolean }): boolean {
  return opts.hasSource && opts.hasCoords && opts.webgl;
}
