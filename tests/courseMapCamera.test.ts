// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapCamera } from "../src/lib/courseMapCamera.ts";

test("a saved camera round-trips", () => {
  const cam = { areaId: "40.7128,-74.0060", lng: -73.9, lat: 40.7, zoom: 11.2, selectedKey: "abc" };
  assert.deepEqual(parseMapCamera(JSON.parse(JSON.stringify(cam))), cam);
});

test("a missing selection is kept as none", () => {
  assert.equal(parseMapCamera({ areaId: "a", lng: 1, lat: 2, zoom: 3 })?.selectedKey, null);
});

test("anything malformed opens the map fresh instead of at a broken view", () => {
  assert.equal(parseMapCamera(null), null);
  assert.equal(parseMapCamera("x"), null);
  assert.equal(parseMapCamera({ areaId: "a", lng: Number.NaN, lat: 2, zoom: 3 }), null);
  assert.equal(parseMapCamera({ areaId: "a", lng: 1, lat: 95, zoom: 3 }), null);
  assert.equal(parseMapCamera({ areaId: "a", lng: 1, lat: 2, zoom: 40 }), null);
  assert.equal(parseMapCamera({ lng: 1, lat: 2, zoom: 3 }), null);
});
