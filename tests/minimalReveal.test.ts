// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageRevealDelta, revealDelta, scrollerRevealDelta } from "../src/lib/minimalReveal.ts";

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

// The page-level reveal's own math, moved out of
// useRevealFocusedFieldAboveKeyboard unchanged. `old` is the inline
// expression it replaced, kept here as the reference.
function oldPageDelta(top: number, bottom: number, innerHeight: number, kb: number, headerBottom: number, gap = 12): number {
  const visibleBottom = innerHeight - kb - gap;
  if (bottom <= visibleBottom) return 0;
  const delta = Math.min(bottom - visibleBottom, top - (headerBottom + gap));
  return delta > 0 ? delta : 0;
}

test("page reveal: same numbers as the old inline math", () => {
  const cases: Array<[number, number, number, number, number]> = [
    [150, 196, 667, 260, 64], // already fits
    [380, 426, 667, 260, 64], // just under the keyboard
    [600, 646, 667, 260, 64], // deep under it
    [90, 400, 667, 260, 64], // tall textarea, top close to the header
    [40, 86, 667, 260, 64], // under the header: never moved
    [700, 900, 844, 336, 100],
    [395, 396, 667, 260, 0],
  ];
  for (const [top, bottom, ih, kb, hb] of cases) {
    const now = pageRevealDelta({ fieldTop: top, fieldBottom: bottom, visibleTop: hb + 12, visibleBottom: ih - kb - 12 });
    assert.equal(now, oldPageDelta(top, bottom, ih, kb, hb), JSON.stringify({ top, bottom, ih, kb, hb }));
  }
});

test("page reveal: smallest move, never past the header, no-op when visible", () => {
  const g = { visibleTop: 76, visibleBottom: 395 };
  assert.equal(pageRevealDelta({ fieldTop: 150, fieldBottom: 196, ...g }), 0);
  assert.equal(pageRevealDelta({ fieldTop: 380, fieldBottom: 426, ...g }), 31);
  assert.equal(pageRevealDelta({ fieldTop: 100, fieldBottom: 500, ...g }), 24);
  assert.equal(pageRevealDelta({ fieldTop: 40, fieldBottom: 420, ...g }), 0);
});

test("scroller reveal: below wins, above brings it down, inside is a no-op", () => {
  const s = { scrollerTop: 100, scrollerBottom: 500, gap: 12 };
  assert.equal(scrollerRevealDelta({ fieldTop: 200, fieldBottom: 250, ...s }), 0);
  assert.equal(scrollerRevealDelta({ fieldTop: 470, fieldBottom: 520, ...s }), 32);
  assert.equal(scrollerRevealDelta({ fieldTop: 90, fieldBottom: 140, ...s }), -22);
  // Taller than the scroller: its bottom (where typing happens) wins.
  assert.equal(scrollerRevealDelta({ fieldTop: 50, fieldBottom: 600, ...s }), 112);
  assert.equal(scrollerRevealDelta({ fieldTop: 112, fieldBottom: 488, ...s }), 0);
});
