// Run: npm run test:courses  (node --test, built-in type stripping)
// Course picture choice, satellite tile math and the drone orbit rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TILES_FAILED_KEY, chooseThumbSource, courseMediaTabs, overviewAvailable, pickCourseMediaTab } from "../src/lib/courseImageSelect.ts";
import { TileBudget, USGS_MAX_ZOOM, USGS_SOURCE, isUsCourse, lngLatToTile, maptilerTileUrl, tileMosaic, tileSourceFor } from "../src/lib/satelliteTiles.ts";

test("aerial source: USGS NAIP for US courses by default, MapTiler everywhere once keyed, none abroad without it", () => {
  const nyc = { lat: 40.8983, lng: -73.8916 };
  const london = { lat: 51.47, lng: -0.45 };
  assert.equal(tileSourceFor(nyc)?.id, "usgs");
  assert.equal(tileSourceFor(london), null);
  assert.equal(tileSourceFor(nyc, "k")?.id, "maptiler");
  assert.equal(tileSourceFor(london, "k")?.id, "maptiler");
  // The country decides when known, whatever the coordinates say.
  assert.equal(tileSourceFor({ ...london, country: "United States" })?.id, "usgs");
  assert.equal(tileSourceFor({ ...nyc, country: "Canada" }), null);
});

test("USGS tiles: {z}/{y}/{x} order (row first), served to z16", () => {
  assert.equal(USGS_SOURCE.url(16, 19395, 24633), "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/16/24633/19395");
  assert.match(USGS_SOURCE.template, /\/tile\/\{z\}\/\{y\}\/\{x\}$/);
  assert.equal(USGS_MAX_ZOOM, 16);
  assert.equal(USGS_SOURCE.credit, "USGS The National Map: Orthoimagery");
});

test("is this course in the US: country first, else coarse boxes incl. Alaska, Hawaii, territories", () => {
  for (const c of ["United States", "united states of america", "USA", "US", "Puerto Rico", "Guam"]) assert.equal(isUsCourse(0, 0, c), true, c);
  for (const c of ["Canada", "Mexico", "United Kingdom", "Japan"]) assert.equal(isUsCourse(40.7, -74, c), false, c);
  const places: [string, number, number, boolean][] = [
    ["Bronx", 40.89, -73.89, true],
    ["Pebble Beach", 36.57, -121.95, true],
    ["Miami", 25.77, -80.19, true],
    ["Anchorage", 61.2, -149.9, true],
    ["Adak (Aleutians)", 51.88, -176.65, true],
    ["Attu (west of 180)", 52.9, 173.2, true],
    ["Honolulu", 21.3, -157.86, true],
    ["San Juan", 18.45, -66.1, true],
    ["Guam", 13.45, 144.79, true],
    ["Pago Pago", -14.28, -170.7, true],
    ["London", 51.5, -0.12, false],
    ["Tokyo", 35.68, 139.69, false],
    ["Mexico City", 19.43, -99.13, false],
    ["Calgary (north of 49)", 51.04, -114.07, false],
    ["Havana", 23.11, -82.37, false],
  ];
  for (const [name, lat, lng, us] of places) assert.equal(isUsCourse(lat, lng), us, name);
  // Known limit of the box fallback (only used without a country): southern
  // Canada falls inside the contiguous box; NAIP tiles 404 there and the
  // view keeps its placeholder.
  assert.equal(isUsCourse(43.65, -79.38), true, "Toronto (box overlap, documented)");
  assert.equal(isUsCourse(43.65, -79.38, "Canada"), false, "the country fixes it");
  assert.equal(isUsCourse(undefined, undefined), false);
});

test("tile budget: distinct URLs per minute; repeats are free; all-or-nothing", () => {
  const b = new TileBudget(5, 60_000);
  assert.equal(b.take(["a", "b", "c"], 0), true);
  assert.equal(b.take(["a", "b", "c"], 1000), true, "repeats are browser-cached, not counted");
  assert.equal(b.take(["d", "e", "f"], 2000), false, "would exceed 5: nothing taken");
  assert.equal(b.take(["d", "e"], 3000), true);
  assert.equal(b.take(["x"], 4000), false);
  assert.equal(b.take(["x"], 61_001), true, "the window slides");
});
import {
  ORBIT_DEG_PER_SEC,
  ORBIT_RESUME_AFTER_MS,
  normalizeBearing,
  orbitBearing,
  orbitRunning,
  orbitStep,
  overviewMotion,
} from "../src/lib/droneOrbit.ts";

const none = new Set<string>();

test("thumb priority: hand-picked, real photo, satellite tiles, Mapbox image, placeholder", () => {
  const base = { mode: "photo" as const, tilesAvailable: true, staticUrl: "https://mapbox/x.png", failed: none };
  assert.deepEqual(chooseThumbSource({ ...base, handpickedUrl: "/h.jpg", photo: { url: "https://g/p", source: "google" } }), {
    kind: "photo",
    url: "/h.jpg",
    source: "handpicked",
  });
  assert.deepEqual(chooseThumbSource({ ...base, photo: { url: "https://g/p", source: "google" } }), { kind: "photo", url: "https://g/p", source: "google" });
  assert.deepEqual(chooseThumbSource({ ...base, photo: null }), { kind: "tiles" });
  assert.deepEqual(chooseThumbSource({ ...base, tilesAvailable: false }), { kind: "static", url: "https://mapbox/x.png" });
  assert.deepEqual(chooseThumbSource({ ...base, tilesAvailable: false, staticUrl: null }), { kind: "none" });
});

test("a failed image falls through to the next source", () => {
  const failed = new Set(["https://g/p", TILES_FAILED_KEY]);
  assert.deepEqual(
    chooseThumbSource({ mode: "photo", photo: { url: "https://g/p", source: "google" }, tilesAvailable: true, staticUrl: "https://m", failed }),
    { kind: "static", url: "https://m" },
  );
});

test("Satellite mode ignores photos", () => {
  assert.deepEqual(
    chooseThumbSource({ mode: "satellite", handpickedUrl: "/h.jpg", photo: { url: "https://g/p", source: "wikimedia" }, tilesAvailable: true, failed: none }),
    { kind: "tiles" },
  );
});

test("course page views: overview, photo; still satellite only without the overview", () => {
  assert.deepEqual(courseMediaTabs({ overviewAvailable: true, hasPhoto: true, hasStaticSatellite: true }), ["overview", "photo"]);
  assert.deepEqual(courseMediaTabs({ overviewAvailable: true, hasPhoto: false, hasStaticSatellite: true }), ["overview"]);
  assert.deepEqual(courseMediaTabs({ overviewAvailable: false, hasPhoto: true, hasStaticSatellite: true }), ["photo", "satellite"]);
  assert.deepEqual(courseMediaTabs({ overviewAvailable: false, hasPhoto: false, hasStaticSatellite: false }), []);
});

test("default view: the golfer's pick while offered, else the first", () => {
  assert.equal(pickCourseMediaTab(["overview", "photo"], null), "overview");
  assert.equal(pickCourseMediaTab(["overview", "photo"], "photo"), "photo");
  assert.equal(pickCourseMediaTab(["overview"], "photo"), "overview");
  assert.equal(pickCourseMediaTab([], "photo"), null);
});

test("overview needs an aerial source, coordinates and WebGL", () => {
  assert.equal(overviewAvailable({ hasSource: true, hasCoords: true, webgl: true }), true);
  assert.equal(overviewAvailable({ hasSource: false, hasCoords: true, webgl: true }), false);
  assert.equal(overviewAvailable({ hasSource: true, hasCoords: false, webgl: true }), false);
  assert.equal(overviewAvailable({ hasSource: true, hasCoords: true, webgl: false }), false);
});

test("tile coordinates: the standard Web-Mercator scheme", () => {
  const t = lngLatToTile(0, 0, 1);
  assert.deepEqual([t.x, t.y], [1, 1]);
  assert.equal(lngLatToTile(-180, 0, 3).x, 0);
  // North/south mirror around the equator.
  const n = lngLatToTile(-74, 40.6, 15);
  const s = lngLatToTile(-74, -40.6, 15);
  assert.ok(Math.abs(n.y + s.y - 2 ** 15) < 1e-6);
  // Pixel y at zoom 15 for 40.6145 N (independent closed form: the
  // Mercator y = ln(tan(pi/4 + lat/2))).
  const merc = Math.log(Math.tan(Math.PI / 4 + (40.6145 * Math.PI) / 360));
  assert.ok(Math.abs(lngLatToTile(-74.0216, 40.6145, 15).y - ((1 - merc / Math.PI) / 2) * 2 ** 15) < 1e-6);
});

test("mosaic covers the whole view with the point at its centre", () => {
  const lat = 40.6145;
  const lng = -74.0216;
  const tiles = tileMosaic({ lat, lng, zoom: 15, width: 56, height: 56, tilePx: 90 });
  assert.ok(tiles.length >= 1 && tiles.length <= 4);
  // Every view pixel is covered by exactly one tile.
  for (const [vx, vy] of [[0, 0], [55.9, 0], [0, 55.9], [55.9, 55.9], [28, 28]]) {
    const covering = tiles.filter((t) => vx >= t.left && vx < t.left + 90 && vy >= t.top && vy < t.top + 90);
    assert.equal(covering.length, 1, `pixel ${vx},${vy}`);
  }
  // The view centre is the course point.
  const { x, y } = lngLatToTile(lng, lat, 15);
  const centre = tiles.find((t) => t.x === Math.floor(x) && t.y === Math.floor(y))!;
  assert.ok(Math.abs(centre.left + (x - Math.floor(x)) * 90 - 28) < 1e-6);
  assert.ok(Math.abs(centre.top + (y - Math.floor(y)) * 90 - 28) < 1e-6);
});

test("mosaic wraps the antimeridian, skips off-world rows, refuses bad input", () => {
  const wrap = tileMosaic({ lat: 0, lng: 179.999, zoom: 2, width: 200, height: 10, tilePx: 64 });
  assert.ok(wrap.some((t) => t.x === 0) && wrap.some((t) => t.x === 3));
  const pole = tileMosaic({ lat: 85, lng: 0, zoom: 1, width: 10, height: 600, tilePx: 64 });
  assert.ok(pole.every((t) => t.y >= 0 && t.y < 2));
  assert.deepEqual(tileMosaic({ lat: NaN, lng: 0, zoom: 1, width: 1, height: 1, tilePx: 1 }), []);
  assert.deepEqual(tileMosaic({ lat: 0, lng: 0, zoom: 1, width: 0, height: 1, tilePx: 1 }), []);
});

test("tile URL carries the encoded key", () => {
  assert.equal(maptilerTileUrl("a b", 15, 1, 2), "https://api.maptiler.com/tiles/satellite-v4/15/1/2?key=a%20b");
});

test("orbit bearing: steady rate, always within [0, 360)", () => {
  assert.equal(orbitBearing(0, 1000), ORBIT_DEG_PER_SEC);
  assert.equal(orbitBearing(350, 5000), normalizeBearing(350 + 5 * ORBIT_DEG_PER_SEC));
  assert.equal(orbitBearing(10, -500), 10);
  assert.equal(normalizeBearing(-30), 330);
  assert.equal(normalizeBearing(720), 0);
  assert.equal(normalizeBearing(NaN), 0);
  // A full circle a minute.
  assert.equal(orbitBearing(0, 60_000), 0);
});

test("a frame step never leaps after a stall", () => {
  assert.equal(orbitStep(0, 16), (16 / 1000) * ORBIT_DEG_PER_SEC);
  assert.equal(orbitStep(0, 10_000), orbitStep(0, 100));
  assert.equal(orbitStep(5, -20), 5);
});

test("reduced motion gets a still view", () => {
  assert.equal(overviewMotion(true), "still");
  assert.equal(overviewMotion(false), "orbit");
});

test("the orbit pauses while touched, off screen, in the background, and for a while after a drag", () => {
  const base = { motion: "orbit" as const, inView: true, pageVisible: true, interacting: false, lastInteractionAt: null, now: 100_000 };
  assert.equal(orbitRunning(base), true);
  assert.equal(orbitRunning({ ...base, motion: "still" }), false);
  assert.equal(orbitRunning({ ...base, inView: false }), false);
  assert.equal(orbitRunning({ ...base, pageVisible: false }), false);
  assert.equal(orbitRunning({ ...base, interacting: true }), false);
  assert.equal(orbitRunning({ ...base, lastInteractionAt: base.now - 1000 }), false);
  assert.equal(orbitRunning({ ...base, lastInteractionAt: base.now - ORBIT_RESUME_AFTER_MS }), true);
});
