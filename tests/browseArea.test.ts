// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialBrowseArea, withBrowseArea } from "../src/lib/browseArea.ts";

const home = { label: "Brooklyn, NY", coords: { lat: 40.65, lng: -73.95 } };
const browsing = { label: "Long Island, NY", coords: { lat: 40.79, lng: -73.13 } };

test("coming Back to the list or map finds the area being browsed, not the saved one", () => {
  // Pick an area: it's written into the current history entry...
  const entry = withBrowseArea(null, browsing);
  // ...so the page rebuilt from that entry after Back starts there.
  assert.deepEqual(initialBrowseArea(entry, home), browsing);
});

test("with nothing browsed yet, the saved area is used", () => {
  assert.deepEqual(initialBrowseArea(null, home), home);
  assert.deepEqual(initialBrowseArea({}, home), home);
  assert.equal(initialBrowseArea(null, undefined), undefined);
});

test("picking an area keeps the rest of the entry (the map's open sheet)", () => {
  assert.deepEqual(withBrowseArea({ sheet: "abc", area: home }, browsing), { sheet: "abc", area: browsing });
});

test("a malformed area in history falls back to the saved one", () => {
  assert.deepEqual(initialBrowseArea({ area: { label: "x" } }, home), home);
});
