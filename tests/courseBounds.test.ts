// Run: npm run test:courses  (node --test, built-in type stripping)
// Framing the course (its OSM outline), and judging whether a photo shows
// the course itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POINT_THUMB_ZOOM,
  boundsCenter,
  boundsFromGeometry,
  distanceToBounds,
  fitZoom,
  outlineFromGeoapifyFeature,
  overviewFraming,
  pickCourseOutline,
  stillFraming,
  validBounds,
  type CourseBounds,
} from "../supabase/functions/_shared/courseBounds.ts";
import { photoCourseScore, photoShowsCourse } from "../supabase/functions/_shared/coursePhotoMatch.ts";
import { tileZoomFor } from "../src/lib/satelliteTiles.ts";

// Van Cortlandt Golf Course's OSM outline (real, from Overpass 2026-11-05),
// and its demo point.
const VC: CourseBounds = { south: 40.8903751, west: -73.8914454, north: 40.906012, east: -73.8836547 };
// 13 m west of the outline, like a pin on the entrance road.
const VC_POINT = { lat: 40.8983, lng: -73.8916 };
const bb = (b: CourseBounds) => ({ minlat: b.south, minlon: b.west, maxlat: b.north, maxlon: b.east });

test("valid outlines: a real course passes; slivers, continents and bad numbers don't", () => {
  assert.equal(validBounds(VC), true);
  assert.equal(validBounds({ south: 40, west: -73, north: 40.0005, east: -72.9995 }), false, "< 150 m");
  assert.equal(validBounds({ south: 40, west: -74, north: 41, east: -73 }), false, "> 6 km");
  assert.equal(validBounds({ south: 41, west: -73, north: 40, east: -72 }), false, "inverted");
  assert.equal(validBounds({ south: NaN, west: 0, north: 1, east: 1 }), false);
  assert.equal(validBounds(null), false);
});

test("distance to an outline is 0 inside, metres outside", () => {
  const c = boundsCenter(VC);
  assert.equal(distanceToBounds(c.lat, c.lng, VC), 0);
  assert.ok(Math.abs(distanceToBounds(VC_POINT.lat, VC_POINT.lng, VC) - 13) < 2);
  assert.ok(Math.abs(distanceToBounds(VC.north + 0.009, -73.887, VC) - 1000) < 5);
});

test("outline choice: this course's, near our point; never a sibling course, range or mini golf", () => {
  const elements = [
    { tags: { leisure: "golf_course", name: "Mosholu Golf Course" }, bounds: bb({ south: 40.8835, west: -73.8814, north: 40.8885, east: -73.8749 }) },
    { tags: { leisure: "golf_course", name: "Van Cortlandt Golf Course" }, bounds: bb(VC) },
    { tags: { leisure: "golf_course", golf: "driving_range", name: "Van Cortlandt Range" }, bounds: bb(VC) },
  ];
  assert.deepEqual(pickCourseOutline({ name: "Van Cortlandt Park Golf Course", ...VC_POINT }, elements), VC);
  // Bethpage Red must not take a "Bethpage Black" outline.
  const black = [{ tags: { leisure: "golf_course", name: "Bethpage Black Course" }, bounds: bb({ south: 40.74, west: -73.46, north: 40.75, east: -73.45 }) }];
  assert.equal(pickCourseOutline({ name: "Bethpage Red", lat: 40.745, lng: -73.455 }, black), null);
  // The whole facility's outline (no colour named) is fine for any of them.
  const park = [{ tags: { leisure: "golf_course", name: "Bethpage State Park Golf Courses" }, bounds: bb({ south: 40.735, west: -73.47, north: 40.76, east: -73.44 }) }];
  assert.ok(pickCourseOutline({ name: "Bethpage Red", lat: 40.745, lng: -73.455 }, park));
  // Too far from our point (a different course across town).
  assert.equal(pickCourseOutline({ name: "Van Cortlandt Park Golf Course", lat: VC.north + 0.01, lng: -73.89 }, [elements[1]]), null);
  assert.equal(pickCourseOutline({ name: "X", lat: 0, lng: 0 }, []), null);
});

test("Geoapify Place Details geometry becomes an outline (polygons only, golf/park, named, nearby)", () => {
  const ring = [[VC.west, VC.south], [VC.east, VC.south], [VC.east, VC.north], [VC.west, VC.north], [VC.west, VC.south]];
  assert.deepEqual(boundsFromGeometry({ type: "Polygon", coordinates: [ring] }), VC);
  assert.deepEqual(boundsFromGeometry({ type: "MultiPolygon", coordinates: [[ring]] }), VC);
  assert.equal(boundsFromGeometry({ type: "Point", coordinates: [VC.west, VC.south] }), null);
  assert.equal(boundsFromGeometry({ type: "Polygon", coordinates: "junk" }), null);
  const feature = { properties: { name: "Van Cortlandt Golf Course", categories: ["sport.golf"] }, geometry: { type: "Polygon", coordinates: [ring] } };
  assert.deepEqual(outlineFromGeoapifyFeature({ name: "Van Cortlandt Park Golf Course", ...VC_POINT }, feature), VC);
  assert.equal(outlineFromGeoapifyFeature({ name: "Van Cortlandt Park Golf Course", ...VC_POINT }, { ...feature, properties: { ...feature.properties, categories: ["commercial.shopping_mall"] } }), null);
  assert.equal(outlineFromGeoapifyFeature({ name: "Mosholu Golf Course", ...VC_POINT }, feature), null, "different name");
});

test("fit zoom: a ~1.8 km tall course fills a phone-width view around zoom 13-14", () => {
  const z = fitZoom(VC, 360, 225);
  assert.ok(z > 13 && z < 14.5, String(z));
  // Twice the width of view -> one zoom level more.
  assert.ok(Math.abs(fitZoom(VC, 720, 450) - z - 1) < 1e-9);
});

test("still framing: the outline's centre when known, else our point at the wider fallback zoom", () => {
  const f = stillFraming(VC_POINT, VC, 56, 56, POINT_THUMB_ZOOM);
  assert.deepEqual([f.lat, f.lng], [boundsCenter(VC).lat, boundsCenter(VC).lng]);
  assert.ok(f.zoom >= 13 && f.zoom <= 17.5);
  assert.deepEqual(stillFraming(VC_POINT, null, 56, 56, POINT_THUMB_ZOOM), { ...VC_POINT, zoom: POINT_THUMB_ZOOM });
});

test("overview framing: tilted camera sits a little closer than a flat fit, within limits", () => {
  const o = overviewFraming(VC_POINT, VC, 360, 225);
  assert.ok(o.zoom > fitZoom(VC, 360, 225, 0) && o.zoom <= 17.5);
  assert.deepEqual([o.lat, o.lng], [boundsCenter(VC).lat, boundsCenter(VC).lng]);
  assert.equal(overviewFraming(VC_POINT, null, 360, 225).lat, VC_POINT.lat);
});

test("fractional zooms become whole-zoom tiles drawn to scale", () => {
  assert.deepEqual(tileZoomFor(15), { z: 15, tilePx: 256 });
  const t = tileZoomFor(15.5);
  assert.equal(t.z, 15);
  assert.ok(Math.abs(t.tilePx - 256 * Math.SQRT2) < 1e-9);
  // Past the source's deepest zoom tiles grow at most 1.4x (was 4x here).
  const deep = tileZoomFor(20, 18);
  assert.equal(deep.z, 18);
  assert.ok(Math.abs(deep.tilePx - 256 * 1.4) < 1e-9, String(deep.tilePx));
  assert.deepEqual(tileZoomFor(NaN), { z: 0, tilePx: 256 });
});

test("photos must show the course: holes, fairways, greens, aerials", () => {
  assert.ok(photoShowsCourse({ title: "File:Bethpage-golf1.jpg" }));
  assert.ok(photoShowsCourse({ title: "File:Van Cortlandt 7th hole.JPG" }));
  assert.ok(photoShowsCourse({ title: "File:IMG_2041.jpg", categories: "Golf courses in the Bronx|Van Cortlandt Park" }));
  assert.ok(photoCourseScore({ title: "File:Split Rock fairway and green.jpg" }) > photoCourseScore({ title: "File:IMG_1.jpg", categories: "Golf" }));
});

test("never a logo, sign, map, clubhouse, car park or a non-photo file", () => {
  for (const title of [
    "File:Dyker Beach Golf Course logo.jpg",
    "File:Forest Park Golf Course sign.jpg",
    "File:Bethpage course map.jpg",
    "File:Split Rock clubhouse golf.jpg",
    "File:Van Cortlandt golf parking lot.jpg",
    "File:Harbor Links golf.png",
    "File:Liberty National Golf Club.svg",
  ]) {
    assert.equal(photoShowsCourse({ title }), false, title);
  }
  assert.equal(photoShowsCourse({ title: "File:Golf 2014.jpg", description: "<p>The <b>clubhouse</b> at dusk</p>" }), false, "description counts");
  assert.equal(photoShowsCourse({ title: "File:Main Street, Farmingdale.jpg" }), false, "nothing about golf");
});
