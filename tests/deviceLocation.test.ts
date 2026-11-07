// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { COARSE_ACCURACY_M, accuracyRadiusPx, locateProblem, toDisplayFix, watchDeviceLocation } from "../src/lib/deviceLocation.ts";
import type { DeviceFix, LocateProblem } from "../src/lib/deviceLocation.ts";

const brooklyn = { lat: 40.678234, lng: -73.944158, accuracyM: 12 };

test("exact mode shows the real position and accuracy unchanged", () => {
  assert.deepEqual(toDisplayFix(brooklyn, "exact"), brooklyn);
});

test("coarse mode rounds to ~1 km and never claims better than that", () => {
  assert.deepEqual(toDisplayFix(brooklyn, "coarse"), { lat: 40.68, lng: -73.94, accuracyM: COARSE_ACCURACY_M });
  // A poor fix keeps its own, larger circle.
  assert.equal(toDisplayFix({ ...brooklyn, accuracyM: 3000 }, "coarse").accuracyM, 3000);
});

test("a missing or nonsense accuracy is treated as none", () => {
  assert.equal(toDisplayFix({ ...brooklyn, accuracyM: Number.NaN }, "exact").accuracyM, 0);
  assert.equal(toDisplayFix({ ...brooklyn, accuracyM: -5 }, "exact").accuracyM, 0);
});

test("the accuracy circle follows map scale", () => {
  // At the equator, zoom 0: one 512 px world, ~78 km per px.
  assert.ok(Math.abs(accuracyRadiusPx(78_271.5, 0, 0) - 1) < 0.001);
  // Each zoom level doubles it.
  const z12 = accuracyRadiusPx(100, 40.7, 12);
  assert.ok(Math.abs(accuracyRadiusPx(100, 40.7, 13) - 2 * z12) < 1e-9);
  // Higher latitudes have fewer metres per pixel, so a bigger circle.
  assert.ok(accuracyRadiusPx(100, 60, 12) > accuracyRadiusPx(100, 0, 12));
  assert.equal(accuracyRadiusPx(0, 40.7, 12), 0);
});

test("only a permission error counts as denied", () => {
  assert.equal(locateProblem(1), "denied");
  assert.equal(locateProblem(2), "unavailable");
  assert.equal(locateProblem(3), "unavailable");
});

function fakeGeolocation() {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null | undefined = null;
  const cleared: number[] = [];
  let options: PositionOptions | undefined;
  return {
    cleared,
    get options() {
      return options;
    },
    geo: {
      watchPosition(ok: PositionCallback, err?: PositionErrorCallback | null, opts?: PositionOptions) {
        success = ok;
        failure = err;
        options = opts;
        return 7;
      },
      clearWatch(id: number) {
        cleared.push(id);
      },
    },
    fix(lat: number, lng: number, accuracy: number) {
      success?.({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
    },
    fail(code: number) {
      failure?.({ code } as GeolocationPositionError);
    },
  };
}

function collect() {
  const fixes: DeviceFix[] = [];
  const problems: LocateProblem[] = [];
  return { fixes, problems, cb: { onFix: (f: DeviceFix) => fixes.push(f), onProblem: (p: LocateProblem) => problems.push(p) } };
}

test("watching streams live fixes until stopped, then clears the watch", () => {
  const g = fakeGeolocation();
  const c = collect();
  const stop = watchDeviceLocation(g.geo, "exact", c.cb);
  assert.equal(g.options?.enableHighAccuracy, true);
  g.fix(40.7, -73.9, 15);
  g.fix(40.701, -73.901, 8);
  assert.deepEqual(c.fixes, [
    { lat: 40.7, lng: -73.9, accuracyM: 15 },
    { lat: 40.701, lng: -73.901, accuracyM: 8 },
  ]);
  stop();
  assert.deepEqual(g.cleared, [7]);
  g.fix(41, -74, 5);
  assert.equal(c.fixes.length, 2, "nothing arrives after the map closes");
});

test("coarse watching never hands out the precise fix", () => {
  const g = fakeGeolocation();
  const c = collect();
  watchDeviceLocation(g.geo, "coarse", c.cb);
  g.fix(brooklyn.lat, brooklyn.lng, 10);
  assert.deepEqual(c.fixes, [{ lat: 40.68, lng: -73.94, accuracyM: COARSE_ACCURACY_M }]);
});

test("a denial stops the watch; a timeout keeps listening", () => {
  const g = fakeGeolocation();
  const c = collect();
  watchDeviceLocation(g.geo, "exact", c.cb);
  g.fail(3);
  assert.deepEqual(g.cleared, []);
  g.fix(40.7, -73.9, 20);
  assert.equal(c.fixes.length, 1);
  g.fail(1);
  assert.deepEqual(c.problems, ["unavailable", "denied"]);
  assert.deepEqual(g.cleared, [7]);
});

test("no geolocation at all says so instead of failing silently", () => {
  const c = collect();
  const stop = watchDeviceLocation(undefined, "exact", c.cb);
  assert.deepEqual(c.problems, ["unsupported"]);
  stop();
});
