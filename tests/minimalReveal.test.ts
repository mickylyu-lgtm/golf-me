// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { revealDelta } from "../src/lib/minimalReveal.ts";

// iPhone SE-ish: header ends at 64, keyboard leaves 667 - 260 = 407 visible.
const band = { visibleTop: 76, visibleBottom: 395 };

test("already fits: no movement at all", () => {
  assert.equal(revealDelta({ fieldTop: 150, fieldBottom: 196, room: 120, ...band }), 0);
});

test("only the missing room is scrolled, not the field to the top", () => {
  // Field at 250-296, wants 120 below -> bottom 416, 21 px over the band.
  assert.equal(revealDelta({ fieldTop: 250, fieldBottom: 296, room: 120, ...band }), 21);
});

test("never scrolls the field behind the header, even if the room doesn't fit", () => {
  // Field low on the page: needs 300, but only 224 is allowed (300 - 76).
  assert.equal(revealDelta({ fieldTop: 300, fieldBottom: 346, room: 349, ...band }), 224);
});

test("a field under the header comes back down into view", () => {
  assert.equal(revealDelta({ fieldTop: 40, fieldBottom: 86, room: 120, ...band }), -36);
});

test("no room wanted: only the field itself", () => {
  assert.equal(revealDelta({ fieldTop: 380, fieldBottom: 426, room: 0, ...band }), 31);
});
