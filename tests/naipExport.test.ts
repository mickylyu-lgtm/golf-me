// Run: npm run test:courses  (node --test, built-in type stripping)
// The one sharp NAIP picture per course: bbox -> export params, its corners,
// and when it's shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAIP_EXPORT_URL,
  NAIP_FAST_MS,
  NAIP_GIVE_UP_MS,
  detailReveal,
  imageRectInView,
  lngLatToMerc,
  mercToLngLat,
  naipExportFor,
  naipMaxPxFor,
} from "../src/lib/naipExport.ts";
import type { CourseBounds } from "../supabase/functions/_shared/courseBounds.ts";

const FOREST_PARK: CourseBounds = { south: 40.6969132, west: -73.8688458, north: 40.7026627, east: -73.8589546 };
const VAN_CORTLANDT: CourseBounds = { south: 40.8903751, west: -73.8914454, north: 40.906012, east: -73.8836547 };
const BETHPAGE: CourseBounds = { south: 40.7354678, west: -73.4725884, north: 40.7571359, east: -73.4346576 };

const params = (url: string) => new URL(url).searchParams;

test("mercator round trip", () => {
  const [x, y] = lngLatToMerc(-73.86, 40.7);
  const [lng, lat] = mercToLngLat(x, y);
  assert.ok(Math.abs(lng + 73.86) < 1e-9 && Math.abs(lat - 40.7) < 1e-9);
});

test("export URL: the NAIP Plus ImageServer, Web Mercator in and out, one JPEG", () => {
  const e = naipExportFor(FOREST_PARK, { devicePixelRatio: 3 })!;
  assert.ok(e.url.startsWith(`${NAIP_EXPORT_URL}?`));
  const p = params(e.url);
  assert.equal(p.get("bboxSR"), "3857");
  assert.equal(p.get("imageSR"), "3857");
  assert.equal(p.get("format"), "jpg");
  assert.equal(p.get("f"), "image");
  assert.equal(p.get("size"), `${e.width},${e.height}`);
  assert.deepEqual(p.get("bbox")!.split(",").map(Number), e.bbox);
});

test("the picture is sized to the screen and never past the service's limits", () => {
  assert.equal(naipMaxPxFor(3), 2048);
  assert.equal(naipMaxPxFor(2), 2048);
  assert.equal(naipMaxPxFor(1), 1024);
  assert.equal(naipMaxPxFor(NaN), 1024);
  for (const b of [FOREST_PARK, VAN_CORTLANDT, BETHPAGE]) {
    for (const dpr of [1, 2, 3]) {
      const e = naipExportFor(b, { devicePixelRatio: dpr })!;
      assert.ok(Math.max(e.width, e.height) <= naipMaxPxFor(dpr), `${e.width}x${e.height}`);
      assert.ok(e.width >= 64 && e.height >= 64);
    }
  }
  // Forest Park on a retina phone: finer than the z16 tiles (~1.8 m there).
  const fp = naipExportFor(FOREST_PARK, { devicePixelRatio: 3 })!;
  assert.ok(fp.metersPerPixel < 0.7 && fp.metersPerPixel >= 0.3, String(fp.metersPerPixel));
});

test("the box's aspect matches the pixel size (so the picture sits exactly on its corners)", () => {
  for (const b of [FOREST_PARK, VAN_CORTLANDT, BETHPAGE]) {
    const e = naipExportFor(b, { devicePixelRatio: 2 })!;
    const boxAspect = (e.bbox[2] - e.bbox[0]) / (e.bbox[3] - e.bbox[1]);
    assert.ok(Math.abs(boxAspect - e.width / e.height) < 0.002, `${boxAspect} vs ${e.width / e.height}`);
  }
  // Tall course (Van Cortlandt runs north-south): height is the long side.
  const vc = naipExportFor(VAN_CORTLANDT, { devicePixelRatio: 2 })!;
  assert.ok(vc.height > vc.width);
});

test("the box covers the outline with padding; corners go TL, TR, BR, BL", () => {
  const e = naipExportFor(FOREST_PARK, { devicePixelRatio: 2 })!;
  const [tl, tr, br, bl] = e.coordinates;
  assert.ok(tl[0] < FOREST_PARK.west && tl[1] > FOREST_PARK.north);
  assert.ok(br[0] > FOREST_PARK.east && br[1] < FOREST_PARK.south);
  assert.equal(tl[1], tr[1]);
  assert.equal(bl[1], br[1]);
  assert.equal(tl[0], bl[0]);
  assert.equal(tr[0], br[0]);
});

test("the same course always asks for the same URL (CloudFront + browser cache hits)", () => {
  assert.equal(naipExportFor({ ...FOREST_PARK }, { devicePixelRatio: 3 })!.url, naipExportFor({ ...FOREST_PARK }, { devicePixelRatio: 3 })!.url);
  // DPR 2 and 3 share a size class, so they share the cached picture too.
  assert.equal(naipExportFor(FOREST_PARK, { devicePixelRatio: 2 })!.url, naipExportFor(FOREST_PARK, { devicePixelRatio: 3 })!.url);
});

test("no outline or a broken one: no request", () => {
  assert.equal(naipExportFor(null), null);
  assert.equal(naipExportFor(undefined), null);
  assert.equal(naipExportFor({ south: 1, west: 1, north: 0, east: 2 }), null);
  assert.equal(naipExportFor({ south: NaN, west: 1, north: 2, east: 2 }), null);
});

test("reveal: at once within 3 s, faded in later, dropped past the give-up time", () => {
  assert.equal(detailReveal(80), "now");
  assert.equal(detailReveal(NAIP_FAST_MS), "now");
  assert.equal(detailReveal(NAIP_FAST_MS + 1), "fade");
  assert.equal(detailReveal(25_000), "fade");
  assert.equal(detailReveal(NAIP_GIVE_UP_MS + 1), "drop");
  assert.equal(detailReveal(NaN), "drop");
  assert.equal(detailReveal(-5), "drop");
});

test("still view placement: the picture lands on its own box in view pixels", () => {
  const e = naipExportFor(FOREST_PARK, { devicePixelRatio: 2 })!;
  const [cx, cy] = [(e.coordinates[0][0] + e.coordinates[1][0]) / 2, (e.coordinates[0][1] + e.coordinates[3][1]) / 2];
  // Centred on the picture's own centre (in mercator), it's centred in view.
  const [mx0, my0, mx1, my1] = e.bbox;
  const [clng, clat] = mercToLngLat((mx0 + mx1) / 2, (my0 + my1) / 2);
  const r = imageRectInView({ lat: clat, lng: clng, zoom: 15, width: 400, height: 250 }, e.bbox);
  assert.ok(Math.abs(r.left + r.width / 2 - 200) < 1e-6 && Math.abs(r.top + r.height / 2 - 125) < 1e-6);
  // One zoom more = twice as large.
  const r2 = imageRectInView({ lat: clat, lng: clng, zoom: 16, width: 400, height: 250 }, e.bbox);
  assert.ok(Math.abs(r2.width / r.width - 2) < 1e-9);
  assert.ok(Math.abs(cx - clng) < 0.01 && Math.abs(cy - clat) < 0.01);
});
