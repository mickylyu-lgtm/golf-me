// Run: npm run test:courses  (node --test, built-in type stripping)
// OSM golf features -> the overview's layout layers, and the browser-side
// fetch/cache fallbacks (lib/courseDetailImagery).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holeBelongsTo,
  holeNumber,
  isCourseLayout,
  layoutBounds,
  layoutOverpassQuery,
  reframeOnLayout,
  layoutToGeoJSON,
  parseCourseLayout,
  simplifyLine,
  type OsmLayoutElement,
} from "../supabase/functions/_shared/courseLayout.ts";

const pt = (lon: number, lat: number) => ({ lat, lon });
// A small closed square around (lon, lat).
const square = (lon: number, lat: number, d = 0.0002) => [pt(lon - d, lat - d), pt(lon + d, lat - d), pt(lon + d, lat + d), pt(lon - d, lat + d), pt(lon - d, lat - d)];
const hole = (ref: string, from: [number, number], to: [number, number], extra: Record<string, string> = {}): OsmLayoutElement => ({
  type: "way",
  tags: { golf: "hole", ref, par: "4", ...extra },
  geometry: [pt(...from), pt((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), pt(...to)],
});

// Two courses side by side: Black to the west (lon -73.47), Red to the east (-73.44).
const FACILITY: { elements: OsmLayoutElement[] } = {
  elements: [
    hole("Black - 1", [-73.47, 40.74], [-73.47, 40.745], { "golf:course:name": "Black" }),
    hole("Black - 2", [-73.471, 40.745], [-73.471, 40.75], { "golf:course:name": "Black" }),
    hole("Red - 1", [-73.44, 40.74], [-73.44, 40.745], { "golf:course:name": "Red" }),
    { type: "way", tags: { golf: "green" }, geometry: square(-73.47, 40.7452) },
    { type: "way", tags: { golf: "green" }, geometry: square(-73.44, 40.7452) },
    { type: "way", tags: { golf: "bunker" }, geometry: square(-73.4705, 40.7448, 0.00005) },
    { type: "way", tags: { golf: "tee" }, geometry: square(-73.47, 40.7398, 0.00005) },
    { type: "way", tags: { golf: "water_hazard" }, geometry: square(-73.4702, 40.742, 0.0003) },
    // A multipolygon fairway: its closed outer ring is used, the inner skipped.
    { type: "relation", tags: { golf: "fairway" }, members: [{ type: "way", role: "outer", geometry: square(-73.47, 40.7425, 0.0004) }, { type: "way", role: "inner", geometry: square(-73.47, 40.7425, 0.0001) }] },
    // Junk: unclosed area, hole without a number, an unknown golf tag, no tags, bad points.
    { type: "way", tags: { golf: "fairway" }, geometry: [pt(-73.47, 40.74), pt(-73.471, 40.741), pt(-73.472, 40.74)] },
    { type: "way", tags: { golf: "hole" }, geometry: [pt(-73.47, 40.74), pt(-73.47, 40.741)] },
    { type: "way", tags: { golf: "clubhouse" }, geometry: square(-73.47, 40.739) },
    { type: "way", geometry: square(-73.47, 40.739) },
    { type: "way", tags: { golf: "green" }, geometry: [null, pt(NaN, 1)] },
  ],
};

test("Overpass query: golf areas + holes inside the padded outline box, with geometry", () => {
  const q = layoutOverpassQuery({ south: 40.7, west: -73.9, north: 40.71, east: -73.88 });
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /fairway\|green\|bunker\|tee\|water_hazard\|lateral_water_hazard\|hole/);
  assert.match(q, /\(40\.699500,-73\.900500,40\.710500,-73\.879500\)/);
  assert.match(q, /out tags geom/);
});

test("hole numbers from ref: plain, facility-prefixed, none", () => {
  assert.equal(holeNumber("7"), "7");
  assert.equal(holeNumber("Yellow - 13"), "13");
  assert.equal(holeNumber("18a"), "18a");
  assert.equal(holeNumber(undefined), null);
  assert.equal(holeNumber("Practice"), null);
});

test("a facility's holes are matched to our course by golf:course:name", () => {
  assert.equal(holeBelongsTo("Bethpage Black", "Black"), true);
  assert.equal(holeBelongsTo("Bethpage Black", "Blue"), false);
  assert.equal(holeBelongsTo("Bethpage Red", "red"), true);
  assert.equal(holeBelongsTo("Forest Park Golf Course", undefined), true);
});

test("parse: our course's holes, and only the areas nearest to them", () => {
  const black = parseCourseLayout(FACILITY, "Bethpage Black")!;
  assert.ok(isCourseLayout(black));
  assert.deepEqual(black.holes.map((h) => h.number), ["1", "2"]);
  assert.equal(black.holes[0].par, 4);
  const kinds = black.areas.map((a) => a.kind).sort();
  // Black's green, bunker, tee, water and the relation fairway; not Red's green, no junk.
  assert.deepEqual(kinds, ["bunker", "fairway", "green", "tee", "water"]);
  const red = parseCourseLayout(FACILITY, "Bethpage Red")!;
  assert.deepEqual(red.holes.map((h) => h.number), ["1"]);
  assert.deepEqual(red.areas.map((a) => a.kind), ["green"]);
  // Every ring is closed, every point a finite [lng, lat].
  for (const a of black.areas) {
    assert.deepEqual(a.ring[0], a.ring[a.ring.length - 1]);
    assert.ok(a.ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x < 0 && y > 0));
  }
});

test("a single-course layout keeps everything (no golf:course:name)", () => {
  const single = { elements: FACILITY.elements.map((e) => (e.tags?.["golf:course:name"] ? { ...e, tags: { golf: "hole", ref: e.tags.ref!.replace(/\D+/g, "") } } : e)) };
  const l = parseCourseLayout(single, "Forest Park Golf Course")!;
  assert.equal(l.holes.length, 3);
  assert.equal(l.areas.filter((a) => a.kind === "green").length, 2);
});

test("nothing usable -> null (the overview just shows the picture)", () => {
  assert.equal(parseCourseLayout({ elements: [] }, "X"), null);
  assert.equal(parseCourseLayout(null, "X"), null);
  assert.equal(parseCourseLayout({ elements: [{ type: "way", tags: { golf: "bunker" }, geometry: square(0, 0) }] }, "X"), null);
  // A facility where none of the holes is ours: no stray areas either.
  assert.equal(parseCourseLayout(FACILITY, "Bethpage Yellow"), null);
});

test("simplify keeps shape ends and closed rings, drops sub-metre wiggles", () => {
  const straight: [number, number][] = Array.from({ length: 50 }, (_, i) => [-73 + i * 0.0001, 40 + (i % 2) * 0.000001]);
  const s = simplifyLine(straight);
  assert.deepEqual(s[0], straight[0]);
  assert.deepEqual(s[s.length - 1], straight[straight.length - 1]);
  assert.ok(s.length <= 3, String(s.length));
  const ring = square(-73, 40).map((p) => [p.lon, p.lat] as [number, number]);
  const r = simplifyLine(ring);
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], r[4]);
});

test("GeoJSON: polygons carry their kind, holes are lines, labels sit at the tee", () => {
  const l = parseCourseLayout(FACILITY, "Bethpage Black")!;
  const gj = layoutToGeoJSON(l);
  assert.equal(gj.areas.features.length, l.areas.length);
  assert.ok(gj.areas.features.every((f) => f.geometry.type === "Polygon" && typeof f.properties.kind === "string"));
  assert.ok(gj.holes.features.every((f) => f.geometry.type === "LineString"));
  assert.deepEqual(gj.labels[0], { number: "1", lng: -73.47, lat: 40.74 });
});

test("cache guard: only our own v1 layouts are trusted", () => {
  assert.equal(isCourseLayout({ v: 1, areas: [], holes: [] }), true);
  assert.equal(isCourseLayout({ v: 2, areas: [], holes: [] }), false);
  assert.equal(isCourseLayout(null), false);
  assert.equal(isCourseLayout({ v: 1, areas: "x", holes: [] }), false);
});

test("multi-course facility: the overview re-frames on our course's own holes", () => {
  const black = parseCourseLayout(FACILITY, "Bethpage Black")!;
  const own = layoutBounds(black)!;
  assert.deepEqual([own.west, own.east], [-73.471, -73.47]);
  const facility = { south: 40.735, west: -73.4726, north: 40.7572, east: -73.4346 };
  assert.equal(reframeOnLayout(facility, own), true);
  // A single course filling its outline: keep the outline framing.
  assert.equal(reframeOnLayout(own, own), false);
  // Holes outside the outline (wrong match): never re-frame.
  assert.equal(reframeOnLayout({ south: 0, west: 0, north: 1, east: 1 }, own), false);
  assert.equal(reframeOnLayout(facility, null), false);
  assert.equal(layoutBounds({ v: 1, areas: [], holes: [] }), null);
});

// ---- browser fetch + cache fallbacks (lib/courseDetailImagery) ----

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const B = { south: 40.74, west: -73.475, north: 40.752, east: -73.435 };

test("layout fetch: second endpoint when the first fails, cached on this device, null when both fail", async () => {
  const storage = memoryStorage();
  const calls: string[] = [];
  let mode: "first-fails" | "all-fail" = "first-fails";
  Object.assign(globalThis, {
    localStorage: storage,
    fetch: async (url: string) => {
      calls.push(new URL(url).hostname);
      if (mode === "all-fail") throw new TypeError("network");
      if (calls.length === 1) return { ok: false, status: 504, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => FACILITY };
    },
  });
  const { fetchCourseLayout, layoutCacheKey, LAYOUT_OVERPASS_ENDPOINTS } = await import("../src/lib/courseDetailImagery.ts");
  const l = await fetchCourseLayout("Bethpage Black", B);
  assert.deepEqual(l?.holes.map((h) => h.number), ["1", "2"]);
  assert.deepEqual(calls, LAYOUT_OVERPASS_ENDPOINTS.map((e) => new URL(e).hostname));
  assert.ok(storage.getItem(layoutCacheKey("Bethpage Black", B)));

  // Same course again in the session: no new request.
  await fetchCourseLayout("Bethpage Black", B);
  assert.equal(calls.length, 2);

  // Cached on the device (a new session = a fresh module): no request.
  const fresh = await import(`../src/lib/courseDetailImagery.ts?session=2`);
  const again = await fresh.fetchCourseLayout("Bethpage Black", B);
  assert.deepEqual(again?.holes.map((h: { number: string }) => h.number), ["1", "2"]);
  assert.equal(calls.length, 2);

  // Both endpoints down: null, and nothing cached (a later session retries).
  mode = "all-fail";
  const none = await fresh.fetchCourseLayout("Bethpage Red", B);
  assert.equal(none, null);
  assert.equal(storage.getItem(layoutCacheKey("Bethpage Red", B)), null);

  // Broken storage never breaks the page.
  Object.assign(globalThis, {
    localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} },
  });
  mode = "first-fails";
  calls.length = 0;
  const third = await import(`../src/lib/courseDetailImagery.ts?session=3`);
  const ok = await third.fetchCourseLayout("Bethpage Black", B);
  assert.equal(ok?.holes.length, 2);
});

test("picture load: once per URL, a failure is not remembered, a timeout gives up", async () => {
  let made = 0;
  let behaviour: "load" | "error" | "hang" = "load";
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    crossOrigin = "";
    decoding = "";
    set src(_v: string) {
      made++;
      if (behaviour === "hang") return;
      setTimeout(() => {
        if (behaviour === "load") {
          this.naturalWidth = 2048;
          this.onload?.();
        } else this.onerror?.();
      }, 1);
    }
  }
  Object.assign(globalThis, { Image: FakeImage, window: { setTimeout, clearTimeout } });
  const { loadDetailPicture } = await import(`../src/lib/courseDetailImagery.ts?pictures=1`);
  const a = await loadDetailPicture("https://x/a.jpg");
  assert.equal(a.ok, true);
  assert.ok(a.ms >= 0);
  await loadDetailPicture("https://x/a.jpg");
  assert.equal(made, 1);
  behaviour = "error";
  assert.equal((await loadDetailPicture("https://x/b.jpg")).ok, false);
  assert.equal((await loadDetailPicture("https://x/b.jpg")).ok, false);
  assert.equal(made, 3, "a failed picture is asked again next time");
  behaviour = "hang";
  assert.equal((await loadDetailPicture("https://x/c.jpg", 20)).ok, false);
});
