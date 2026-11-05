// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDistanceMiles, roundedMiles } from "../src/lib/geo.ts";
import { inviteDraftToSeed } from "../src/lib/inviteToPlay.ts";

test("under a mile is never a decimal", () => {
  assert.equal(roundedMiles(0), "<1");
  assert.equal(roundedMiles(0.3), "<1");
  assert.equal(roundedMiles(0.99), "<1");
  assert.equal(formatDistanceMiles(0.3), "<1 mi");
});

test("whole miles only above that", () => {
  assert.equal(roundedMiles(1), "1");
  assert.equal(roundedMiles(1.4), "1");
  assert.equal(roundedMiles(2.5), "3");
  assert.equal(roundedMiles(12.49), "12");
  assert.equal(formatDistanceMiles(6.7), "7 mi");
});

test("bad input never shows NaN or a negative", () => {
  assert.equal(roundedMiles(Number.NaN), "<1");
  assert.equal(roundedMiles(-3), "<1");
  assert.equal(roundedMiles(Number.POSITIVE_INFINITY), "<1");
});

test("invite to play only seeds an empty composer, never sends or overwrites", () => {
  assert.equal(inviteDraftToSeed("", "Hi Sam!"), "Hi Sam!");
  assert.equal(inviteDraftToSeed(null, "  Hi Sam!  "), "Hi Sam!");
  assert.equal(inviteDraftToSeed("   ", "Hi Sam!"), "Hi Sam!");
  assert.equal(inviteDraftToSeed("half-typed note", "Hi Sam!"), null);
  assert.equal(inviteDraftToSeed("", "   "), null);
});
