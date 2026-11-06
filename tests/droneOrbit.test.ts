// Run: npm run test:courses  (node --test, built-in type stripping)
// The drone overview's camera: sharp imagery (zoom cap, pitch, retina tile
// size), the zoom units, and the orbit rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVERVIEW_PITCH,
  maplibreZoom,
  orbitRunning,
  orbitStep,
  overviewMotion,
  overviewTileSize,
  overviewZoomCap,
} from "../src/lib/droneOrbit.ts";
import { POINT_OVERVIEW_ZOOM, fitZoom, overviewFraming, type CourseBounds } from "../supabase/functions/_shared/courseBounds.ts";
import { MAX_TILE_UPSCALE, USGS_MAX_ZOOM, USGS_SOURCE, maptilerSource, tileZoomFor } from "../src/lib/satelliteTiles.ts";

// Real OSM outlines (lib/courses.ts demo fixtures).
const VAN_CORTLANDT: CourseBounds = { south: 40.8903751, west: -73.8914454, north: 40.906012, east: -73.8836547 };
const FOREST_PARK: CourseBounds = { south: 40.6969132, west: -73.8688458, north: 40.7026627, east: -73.8589546 };
// A tiny pitch-and-putt sized outline: its flat fit is far past z16.
const TINY: CourseBounds = { south: 40.7, west: -73.9, north: 40.7012, east: -73.8985 };
const BOX = { w: 342, h: 214 };

test("pitch is 45 (was 60)", () => {
  assert.equal(OVERVIEW_PITCH, 45);
});

test("zoom cap: USGS never past 16.3, MapTiler keeps its deeper 17.5", () => {
  assert.equal(overviewZoomCap(USGS_SOURCE.maxZoom), USGS_MAX_ZOOM + 0.3);
  assert.ok(overviewZoomCap(USGS_SOURCE.maxZoom) <= 16.3 + 1e-9);
  assert.equal(overviewZoomCap(maptilerSource("k").maxZoom), 17.5);
  assert.equal(overviewZoomCap(NaN), 16.3);
});

test("MapLibre zoom is one below the 256 px tile zoom", () => {
  assert.equal(maplibreZoom(16.3), 15.3);
  assert.equal(maplibreZoom(14), 13);
});

test("framing stays at the cap: every course on USGS is at or under 16.3", () => {
  const cap = overviewZoomCap(USGS_MAX_ZOOM);
  for (const b of [VAN_CORTLANDT, FOREST_PARK, TINY]) {
    const f = overviewFraming({ lat: 0, lng: 0 }, b, BOX.w, BOX.h, cap);
    assert.ok(f.zoom <= cap + 1e-9, String(f.zoom));
    assert.ok(f.zoom >= 13.5);
  }
  // The tiny one would fit far closer: held at the cap.
  assert.ok(fitZoom(TINY, BOX.w, BOX.h, 0) > 17);
  assert.equal(overviewFraming({ lat: 0, lng: 0 }, TINY, BOX.w, BOX.h, cap).zoom, cap);
  // Under the cap a course is still framed to fit (+ the tilt allowance).
  const vc = overviewFraming({ lat: 0, lng: 0 }, VAN_CORTLANDT, BOX.w, BOX.h, cap);
  assert.ok(Math.abs(vc.zoom - (fitZoom(VAN_CORTLANDT, BOX.w, BOX.h, 0) + 0.35)) < 1e-9);
  // MapTiler frames the tiny course closer than USGS may.
  assert.ok(overviewFraming({ lat: 0, lng: 0 }, TINY, BOX.w, BOX.h, 17.5).zoom > cap);
  // No outline: our point, under the cap too.
  assert.equal(overviewFraming({ lat: 1, lng: 2 }, null, BOX.w, BOX.h, cap).zoom, Math.min(cap, POINT_OVERVIEW_ZOOM));
  // Default (no cap given) keeps the old 17.5 ceiling.
  assert.ok(overviewFraming({ lat: 0, lng: 0 }, TINY, BOX.w, BOX.h).zoom <= 17.5);
});

test("retina screens get USGS tiles at native density; MapTiler and 1x screens keep 256", () => {
  assert.equal(overviewTileSize("usgs", 3), 128);
  assert.equal(overviewTileSize("usgs", 2), 128);
  assert.equal(overviewTileSize("usgs", 1), 256);
  assert.equal(overviewTileSize("usgs", NaN), 256);
  assert.equal(overviewTileSize("maptiler", 3), 256);
});

test("thumbnails never scale USGS z16 tiles up by more than 1.4x", () => {
  for (const zoom of [16, 16.3, 16.49, 16.6, 17.5, 22]) {
    const { z, tilePx } = tileZoomFor(zoom, USGS_MAX_ZOOM);
    assert.ok(z <= 16);
    assert.ok(tilePx <= 256 * MAX_TILE_UPSCALE + 1e-9, `${zoom} -> ${tilePx}`);
  }
  // Below the source's max nothing changes.
  assert.deepEqual(tileZoomFor(15, USGS_MAX_ZOOM), { z: 15, tilePx: 256 });
  // MapTiler (19): 17.5 is still drawn from z17 tiles.
  assert.equal(tileZoomFor(17.5, 19).z, 17);
});

test("orbit rules unchanged: reduced motion is still, a stall never leaps", () => {
  assert.equal(overviewMotion(true), "still");
  assert.equal(overviewMotion(false), "orbit");
  assert.equal(orbitStep(10, 10_000), orbitStep(10, 100));
  const base = { motion: "orbit" as const, inView: true, pageVisible: true, interacting: false, lastInteractionAt: null, now: 0 };
  assert.equal(orbitRunning(base), true);
  assert.equal(orbitRunning({ ...base, motion: "still" }), false);
  assert.equal(orbitRunning({ ...base, lastInteractionAt: 0, now: 1000 }), false);
});
