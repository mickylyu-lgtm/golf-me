// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLOUT_MIN_GAP, PLAY_BUTTON_CLEARANCE, separateCallouts } from "../src/components/caddie/calloutLayout.ts";

// A 320 px tall picture, label centres allowed from 16 to 304; centre 160.
const TOP = 16;
const BOTTOM = 304;

test("two labels at the same height are pushed a label apart, first one stays", () => {
  const c = [{ y: 100 }, { y: 104 }];
  separateCallouts(c, TOP, BOTTOM, false);
  assert.equal(c[0].y, 100);
  assert.equal(c[1].y, 100 + CALLOUT_MIN_GAP);
});

test("at the bottom edge the second label goes above instead", () => {
  const c = [{ y: 300 }, { y: 298 }];
  separateCallouts(c, TOP, BOTTOM, false);
  assert.equal(c[0].y, 300);
  assert.equal(c[1].y, 300 - CALLOUT_MIN_GAP);
});

test("labels already apart are left alone", () => {
  const c = [{ y: 60 }, { y: 250 }];
  separateCallouts(c, TOP, BOTTOM, true);
  assert.deepEqual(c, [{ y: 60 }, { y: 250 }]);
});

test("paused: labels move out of the play button area, and stay apart", () => {
  const c = [{ y: 150 }, { y: 165 }];
  separateCallouts(c, TOP, BOTTOM, true);
  assert.equal(c[0].y, 160 - PLAY_BUTTON_CLEARANCE);
  assert.ok(Math.abs(c[1].y - 160) >= PLAY_BUTTON_CLEARANCE);
  assert.ok(Math.abs(c[0].y - c[1].y) >= CALLOUT_MIN_GAP);
});

test("playing: the centre is allowed", () => {
  const c = [{ y: 160 }];
  separateCallouts(c, TOP, BOTTOM, false);
  assert.equal(c[0].y, 160);
});
