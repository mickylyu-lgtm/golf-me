// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY,
  MAX_SCALE,
  clampState,
  containSize,
  doubleTapTarget,
  panLimits,
  pinchState,
  rubberBand,
  softClampState,
  wheelZoomFactor,
  zoomAboutPoint,
  type ZoomDims,
} from "../src/lib/zoomPan.ts";
import { largestPhotoUrl } from "../src/lib/providerPhoto.ts";

// A 390x844 phone screen showing a 4:3 landscape photo (fits the width).
const dims: ZoomDims = { viewW: 390, viewH: 844, contentW: 390, contentH: 292.5 };

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("containSize: object-fit contain, box fallback while unloaded", () => {
  assert.deepEqual(containSize(4000, 3000, 390, 844), { w: 390, h: 292.5 });
  assert.deepEqual(containSize(1000, 4000, 390, 844), { w: 211, h: 844 });
  assert.deepEqual(containSize(0, 0, 390, 844), { w: 390, h: 844 });
});

test("zoomAboutPoint keeps the picture point under the focus still", () => {
  const focus = { x: 100, y: -50 };
  const before = { scale: 1.5, x: 20, y: 10 };
  const after = zoomAboutPoint(before, 3, focus);
  // Picture point under the focus, before and after: (focus - t) / s.
  near((focus.x - before.x) / before.scale, (focus.x - after.x) / after.scale);
  near((focus.y - before.y) / before.scale, (focus.y - after.y) / after.scale);
  assert.equal(after.scale, 3);
});

test("pinch: spread scales about the midpoint; moving the midpoint pans", () => {
  const mid = { x: 50, y: 80 };
  const s = pinchState(IDENTITY, mid, 100, mid, 200);
  assert.equal(s.scale, 2);
  // The point that was under the fingers is still under them.
  near((mid.x - s.x) / s.scale, mid.x);
  near((mid.y - s.y) / s.scale, mid.y);
  const moved = pinchState(IDENTITY, mid, 100, { x: 70, y: 80 }, 100);
  assert.equal(moved.scale, 1);
  near(moved.x, 20);
});

test("pan limits: centred while it fits, half the overflow once bigger", () => {
  assert.deepEqual(panLimits(1, dims), { maxX: 0, maxY: 0 });
  const at2 = panLimits(2, dims);
  near(at2.maxX, 195); // 780 wide on a 390 screen
  assert.equal(at2.maxY, 0); // 585 tall still fits 844
  near(panLimits(4, dims).maxY, (1170 - 844) / 2);
});

test("clampState: an edge can't be dragged inside the screen edge", () => {
  const c = clampState({ scale: 2, x: 999, y: -400 }, dims);
  near(c.x, 195);
  assert.equal(c.y, 0);
  const left = clampState({ scale: 2, x: -999, y: 0 }, dims);
  near(left.x, -195);
});

test("clampState: scale limited to 1x..4x", () => {
  assert.equal(clampState({ scale: 9, x: 0, y: 0 }, dims).scale, MAX_SCALE);
  assert.deepEqual(clampState({ scale: 0.5, x: 30, y: 30 }, dims), { scale: 1, x: 0, y: 0 });
});

test("rubber band resists past the limit but never stops dead", () => {
  assert.equal(rubberBand(50, -100, 100, 390), 50);
  const over = rubberBand(200, -100, 100, 390);
  assert.ok(over > 100 && over < 200, `${over}`);
  assert.ok(rubberBand(400, -100, 100, 390) > over, "keeps moving, slower");
  const under = rubberBand(-200, -100, 100, 390);
  assert.ok(under < -100 && under > -200);
});

test("softClampState overshoots a little; clampState snaps it back", () => {
  const soft = softClampState({ scale: 6, x: 0, y: 0 }, dims);
  assert.ok(soft.scale > MAX_SCALE && soft.scale < 6);
  assert.equal(clampState(soft, dims).scale, MAX_SCALE);
  const shrunk = softClampState({ scale: 0.5, x: 0, y: 0 }, dims);
  assert.ok(shrunk.scale < 1 && shrunk.scale > 0.5);
});

test("double tap: fit -> 2.5x at the tap, zoomed -> back to fit", () => {
  const tap = { x: 60, y: 20 };
  const z = doubleTapTarget(IDENTITY, tap, dims);
  assert.equal(z.scale, 2.5);
  near(z.x, tap.x - tap.x * 2.5);
  near(z.y, 0); // y still fits at 2.5x (731 < 844), stays centred
  assert.deepEqual(doubleTapTarget(z, tap, dims), IDENTITY);
});

test("double tap near an edge is clamped, no black past the picture", () => {
  const z = doubleTapTarget(IDENTITY, { x: -195, y: 0 }, dims);
  near(z.x, panLimits(2.5, dims).maxX);
});

test("wheel: up zooms in, down zooms out, ctrl (trackpad pinch) is stronger", () => {
  assert.ok(wheelZoomFactor(-100, false) > 1);
  assert.ok(wheelZoomFactor(100, false) < 1);
  assert.ok(wheelZoomFactor(-10, true) > wheelZoomFactor(-10, false));
  // A huge delta is capped, no 1-event jump to the limit.
  assert.equal(wheelZoomFactor(-5000, false), wheelZoomFactor(-100, false));
});

test("largestPhotoUrl: Google photo asked for big, stored avatar as is", () => {
  assert.equal(largestPhotoUrl("https://lh3.googleusercontent.com/a/abc=s96-c"), "https://lh3.googleusercontent.com/a/abc=s1024-c");
  const stored = "https://x.supabase.co/storage/v1/object/public/avatars/u/avatar.jpg?v=3";
  assert.equal(largestPhotoUrl(stored), stored);
});
