// Run: npm run test:chat  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SLIDE_MS, KEYBOARD_EASE, MAX_SLIDE_MS, MIN_SLIDE_MS, cubicBezier, followHeight, insetAt, planFollow, slideDuration } from "../src/lib/keyboard/follow.ts";

// Geometry of a 390x844 DM: box top 97, closed bottom 776 (above the tab
// bar), keyboard 336.
const fullH = 844 - 97;
const closedH = 776 - 97;
const kb = 336;

test("ends exactly where the old instant layout put the box", () => {
  const open = planFollow({ fullH, closedH, fromInset: 0, toInset: kb });
  assert.ok(open);
  assert.equal(followHeight(open, 0), closedH, "starts at the closed height");
  assert.equal(followHeight(open, kb), fullH - kb, "ends at innerHeight - boxTop - keyboard (the DM's own formula)");
  const close = planFollow({ fullH, closedH, fromInset: kb, toInset: 0 });
  assert.ok(close);
  assert.equal(followHeight(close, kb), fullH - kb);
  assert.equal(followHeight(close, 0), closedH);
});

test("the composer stays put until the keyboard's top reaches it, then rides it", () => {
  const plan = planFollow({ fullH, closedH, fromInset: 0, toInset: kb });
  assert.ok(plan);
  const navReserve = fullH - closedH; // tab bar + safe area
  for (const inset of [0, 10, navReserve - 1, navReserve]) assert.equal(followHeight(plan, inset), closedH);
  assert.equal(followHeight(plan, navReserve + 50), closedH - 50);
});

test("nothing to animate: same inset, tiny change, unknown closed height at a closed end, bad numbers", () => {
  assert.equal(planFollow({ fullH, closedH, fromInset: kb, toInset: kb }), null);
  assert.equal(planFollow({ fullH, closedH, fromInset: 0, toInset: 1 }), null, "inside the tab bar reserve: no height change");
  assert.equal(planFollow({ fullH, closedH: null, fromInset: 0, toInset: kb }), null);
  assert.equal(planFollow({ fullH: NaN, closedH, fromInset: 0, toInset: kb }), null);
  // Height change while open (emoji / QuickType): closed height not needed.
  const change = planFollow({ fullH, closedH: null, fromInset: kb, toInset: kb + 40 });
  assert.ok(change);
  assert.equal(followHeight(change, kb + 40), fullH - kb - 40);
});

test("insetAt: starts at from, ends exactly at to, monotonic, never overshoots", () => {
  const plan = { fromInset: 0, toInset: kb };
  assert.equal(insetAt(plan, 0, 250), 0);
  assert.equal(insetAt(plan, 250, 250), kb);
  assert.equal(insetAt(plan, 999, 250), kb);
  assert.equal(insetAt(plan, -5, 250), 0);
  let prev = -1;
  for (let t = 0; t <= 250; t += 5) {
    const v = insetAt(plan, t, 250);
    assert.ok(v >= prev && v <= kb, `t=${t} v=${v}`);
    prev = v;
  }
  let last = Infinity;
  for (let t = 0; t <= 250; t += 5) {
    const v = insetAt({ fromInset: kb, toInset: 0 }, t, 250);
    assert.ok(v <= last && v >= 0);
    last = v;
  }
  assert.equal(insetAt(plan, 10, 0), kb, "zero duration: at the end");
});

test("keyboard ease: fast start, soft landing, exact ends", () => {
  assert.equal(KEYBOARD_EASE(0), 0);
  assert.equal(KEYBOARD_EASE(1), 1);
  assert.ok(KEYBOARD_EASE(0.25) > 0.5, "most of the travel early, like the iOS keyboard");
  assert.ok(KEYBOARD_EASE(0.9) > 0.97);
  const linear = cubicBezier(0, 0, 1, 1);
  for (const p of [0.1, 0.5, 0.9]) assert.ok(Math.abs(linear(p) - p) < 1e-3);
});

test("slide duration: measured when known, clamped, default otherwise", () => {
  assert.equal(slideDuration(null), DEFAULT_SLIDE_MS);
  assert.equal(slideDuration(NaN), DEFAULT_SLIDE_MS);
  assert.equal(slideDuration(330), 330);
  assert.equal(slideDuration(20), MIN_SLIDE_MS);
  assert.equal(slideDuration(5000), MAX_SLIDE_MS);
});
