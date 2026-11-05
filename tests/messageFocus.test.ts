// Run: npm run test:chat  (node --test, built-in type stripping)
// The hold-menu focus: copy scale clamp, bubble shift + menu placement,
// press scale read-back, and the exit presence used for the close animation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOCUS_SCALE,
  PRESS_FEEDBACK_DELAY_MS,
  PRESS_SCALE,
  currentPressScale,
  focusLayout,
  focusScale,
  overhangBelow,
  presenceExited,
  presenceFor,
  type FocusLayoutInput,
  type Presence,
} from "../src/lib/messageFocus.ts";
import { LONG_PRESS_MS } from "../src/lib/messageLongPress.ts";

// iPhone-ish: 390 x 844 visible, 8 px margins.
const viewport = { top: 0, bottom: 844, left: 0, right: 390 };
const menu = { width: 280, height: 190 };
const base = (over: Partial<FocusLayoutInput>): FocusLayoutInput => ({
  bubble: { left: 48, top: 500, width: 200, height: 40 },
  menu,
  viewport,
  alignRight: false,
  reducedMotion: false,
  ...over,
});
const scaledTop = (b: FocusLayoutInput["bubble"], l: { scale: number; dy: number }) => b.top + b.height / 2 - (b.height * l.scale) / 2 + l.dy;
const scaledBottom = (b: FocusLayoutInput["bubble"], l: { scale: number; dy: number }) => scaledTop(b, l) + b.height * l.scale;

test("press cue starts after the delay and finishes before the menu opens", () => {
  assert.ok(PRESS_FEEDBACK_DELAY_MS > 0 && PRESS_FEEDBACK_DELAY_MS < LONG_PRESS_MS);
  assert.ok(PRESS_SCALE < 1 && PRESS_SCALE >= 0.95);
  assert.ok(FOCUS_SCALE > 1 && FOCUS_SCALE <= 1.06);
});

test("focusScale: never shrinks, never larger than the room, target otherwise", () => {
  assert.equal(focusScale({ width: 200, height: 40 }, { width: 374, height: 828 }), FOCUS_SCALE);
  assert.equal(focusScale({ width: 200, height: 810 }, { width: 374, height: 828 }), 828 / 810);
  assert.equal(focusScale({ width: 200, height: 1200 }, { width: 374, height: 828 }), 1);
  assert.equal(focusScale({ width: 0, height: 40 }, { width: 374, height: 828 }), 1);
  assert.equal(focusScale({ width: 200, height: 40 }, { width: 374, height: 828 }, 1), 1);
});

test("middle of the screen: enlarged in place, menu above, no move", () => {
  const input = base({});
  const l = focusLayout(input);
  assert.equal(l.scale, FOCUS_SCALE);
  assert.equal(l.dx, 0);
  assert.equal(l.dy, 0);
  assert.equal(l.placement, "above");
  assert.equal(l.menuTop, scaledTop(input.bubble, l) - 8 - menu.height);
  assert.equal(l.menuLeft, input.bubble.left + input.bubble.width / 2 - (input.bubble.width * l.scale) / 2);
});

test("near the top: the menu goes below without moving the bubble", () => {
  const input = base({ bubble: { left: 48, top: 60, width: 200, height: 40 } });
  const l = focusLayout(input);
  assert.equal(l.placement, "below");
  assert.equal(l.dy, 0);
  assert.equal(l.menuTop, scaledBottom(input.bubble, l) + 8);
});

test("partly scrolled off the top: the bubble is brought on screen", () => {
  const input = base({ bubble: { left: 48, top: -20, width: 200, height: 40 } });
  const l = focusLayout(input);
  assert.equal(l.placement, "below");
  assert.ok(Math.abs(scaledTop(input.bubble, l) - 8) < 1e-9, String(scaledTop(input.bubble, l)));
  assert.ok(l.menuTop + menu.height <= 844 - 8);
});

test("near the bottom (above the composer): menu above, bubble kept on screen", () => {
  const input = base({ bubble: { left: 48, top: 820, width: 200, height: 40 } });
  const l = focusLayout(input);
  assert.equal(l.placement, "above");
  assert.ok(scaledBottom(input.bubble, l) <= 844 - 8 + 1e-9);
  assert.ok(l.menuTop >= 8);
});

test("tall bubble that fits only with a move: the smallest move wins", () => {
  // 500 px bubble at top 150, enlarged to 525 (top 137.5): menu above needs
  // top >= 206 (a 68.5 px move), menu below needs top <= 113 (24.5 px).
  const input = base({ bubble: { left: 48, top: 150, width: 200, height: 500 } });
  const l = focusLayout(input);
  assert.equal(l.scale, FOCUS_SCALE);
  assert.equal(l.placement, "below");
  assert.ok(Math.abs(l.dy - -24.5) < 1e-9, String(l.dy));
  assert.ok(Math.abs(l.menuTop + menu.height - 836) < 1e-9, String(l.menuTop));
  // Nudged the other way, above wins.
  const up = focusLayout(base({ bubble: { left: 48, top: 210, width: 200, height: 500 } }));
  assert.equal(up.placement, "above");
  assert.ok(Math.abs(scaledTop({ left: 48, top: 210, width: 200, height: 500 }, up) - 206) < 1e-9);
  assert.equal(up.menuTop, 8);
});

test("bubble + menu only fit unscaled: scale drops to 1 instead of overflowing", () => {
  // 828 - 8 - 190 = 630 px of room for the bubble; 620 * 1.05 = 651 doesn't fit.
  const input = base({ bubble: { left: 48, top: 100, width: 200, height: 620 } });
  const l = focusLayout(input);
  assert.equal(l.scale, 1);
  assert.ok(scaledTop(input.bubble, l) >= 8 - 1e-9 && scaledBottom(input.bubble, l) <= 836 + 1e-9);
});

test("taller than the screen: not enlarged, not moved, menu clamped on screen", () => {
  const input = base({ bubble: { left: 48, top: -300, width: 260, height: 1400 } });
  const l = focusLayout(input);
  assert.equal(l.scale, 1);
  assert.equal(l.dx, 0);
  assert.equal(l.dy, 0);
  assert.equal(l.placement, "below");
  assert.equal(l.menuTop, 844 - 8 - menu.height);
  const visibleTall = focusLayout(base({ bubble: { left: 48, top: 300, width: 260, height: 900 } }));
  assert.equal(visibleTall.scale, 1);
  assert.equal(visibleTall.dy, 0);
  assert.equal(visibleTall.placement, "above");
  assert.equal(visibleTall.menuTop, 300 - 8 - menu.height);
});

test("never enlarges a tall bubble past the visible height", () => {
  for (const height of [100, 300, 500, 600, 700, 800, 820, 830, 900]) {
    const input = base({ bubble: { left: 48, top: 10, width: 200, height } });
    const l = focusLayout(input);
    assert.ok(height * l.scale <= Math.max(height, 828) + 1e-9, `h=${height} s=${l.scale}`);
  }
});

test("mine: menu right-aligned with the enlarged bubble, clamped inside", () => {
  const input = base({ alignRight: true, bubble: { left: 130, top: 500, width: 220, height: 40 } });
  const l = focusLayout(input);
  const right = 130 + 110 + (220 * l.scale) / 2 + l.dx;
  assert.equal(l.menuLeft, right - menu.width);
  const wide = focusLayout(base({ alignRight: true, menu: { width: 300, height: 190 }, bubble: { left: 330, top: 500, width: 50, height: 40 } }));
  assert.ok(wide.menuLeft + 300 <= 390 - 8 + 1e-9);
  const theirsNarrow = focusLayout(base({ menu: { width: 300, height: 190 }, bubble: { left: 48, top: 500, width: 50, height: 40 } }));
  assert.ok(theirsNarrow.menuLeft >= 8);
});

test("enlarging a full-width bubble never pushes it off the side", () => {
  // 366 px wide, right edge at 380: scale is capped at 374 / 366 and the
  // copy shifts 2 px left to stay inside the 8 px margin.
  const input = base({ bubble: { left: 14, top: 500, width: 366, height: 40 } });
  const l = focusLayout(input);
  assert.ok(Math.abs(l.scale - 374 / 366) < 1e-9, String(l.scale));
  const left = 14 + 183 - (366 * l.scale) / 2 + l.dx;
  assert.ok(Math.abs(l.dx - -2) < 1e-9, String(l.dx));
  assert.ok(left >= 8 - 1e-9 && left + 366 * l.scale <= 382 + 1e-9, `${left} ${l.scale}`);
});

test("keyboard open: uses the visible viewport only", () => {
  const kb = { top: 0, bottom: 500, left: 0, right: 390 };
  const input = base({ viewport: kb, bubble: { left: 48, top: 440, width: 200, height: 40 } });
  const l = focusLayout(input);
  assert.equal(l.placement, "above");
  assert.ok(scaledBottom(input.bubble, l) <= 492 + 1e-9);
  // A visual viewport panned down (iOS Safari): top offset respected.
  const panned = focusLayout(base({ viewport: { top: 300, bottom: 800, left: 0, right: 390 }, bubble: { left: 48, top: 320, width: 200, height: 40 } }));
  assert.equal(panned.placement, "below");
  assert.ok(panned.menuTop >= 308);
});

test("reduced motion: no scale, no move, menu placed like before", () => {
  const mid = focusLayout(base({ reducedMotion: true }));
  assert.deepEqual([mid.scale, mid.dx, mid.dy, mid.placement, mid.menuTop], [1, 0, 0, "above", 500 - 8 - 190]);
  const top = focusLayout(base({ reducedMotion: true, bubble: { left: 48, top: -20, width: 200, height: 40 } }));
  assert.deepEqual([top.scale, top.dy, top.placement, top.menuTop], [1, 0, "below", 28]);
  const bottom = focusLayout(base({ reducedMotion: true, bubble: { left: 48, top: 60, width: 200, height: 760 } }));
  assert.equal(bottom.placement, "below");
  assert.equal(bottom.menuTop, 844 - 8 - 190);
});

test("reaction pill overhang: the menu below clears it, the fit counts it", () => {
  const bubble = { left: 48, top: 60, width: 200, height: 40 };
  const plain = focusLayout(base({ bubble }));
  const withPill = focusLayout(base({ bubble, overhangBottom: 16 }));
  assert.equal(withPill.placement, "below");
  assert.ok(Math.abs(withPill.menuTop - plain.menuTop - 16 * withPill.scale) < 1e-9, `${withPill.menuTop} vs ${plain.menuTop}`);
  // Near the bottom: bubble + pill kept on screen.
  const low = { left: 48, top: 800, width: 200, height: 40 };
  const l = focusLayout(base({ bubble: low, overhangBottom: 16 }));
  assert.ok(scaledBottom(low, l) + 16 * l.scale <= 836 + 1e-9);
  // Reduced motion, menu below: also clears the pill.
  const r = focusLayout(base({ reducedMotion: true, bubble, overhangBottom: 16 }));
  assert.equal(r.menuTop, 60 + 40 + 16 + 8);
  // Negative / missing overhang ignored.
  assert.deepEqual(focusLayout(base({ bubble, overhangBottom: -5 })), plain);
});

test("overhangBelow: lowest child below the box, unscaled", () => {
  assert.equal(overhangBelow(100, [90, 116]), 16);
  assert.equal(overhangBelow(100, [90, 95]), 0);
  assert.equal(overhangBelow(100, []), 0);
  assert.equal(overhangBelow(100, [NaN, 115.52]), 15.519999999999996);
  assert.ok(Math.abs(overhangBelow(100, [115.52], 0.97) - 16) < 1e-9);
  assert.equal(overhangBelow(100, [116], 0), 0);
});

test("currentPressScale: reads the pressed scale, rejects nonsense", () => {
  assert.equal(currentPressScale(194, 200), 0.97);
  assert.equal(currentPressScale(200, 200), 1);
  assert.equal(currentPressScale(210, 200), 1);
  assert.equal(currentPressScale(100, 200), 1);
  assert.equal(currentPressScale(0, 200), 1);
  assert.equal(currentPressScale(194, 0), 1);
});

test("presence: open, close (exiting), exit done, reopen during exit remounts", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  let p: Presence<typeof a> = { value: null, exiting: false, key: 0 };
  p = presenceFor(p, a);
  assert.deepEqual(p, { value: a, exiting: false, key: 1 });
  assert.equal(presenceFor(p, a), p, "stable while open");
  p = presenceFor(p, null);
  assert.deepEqual(p, { value: a, exiting: true, key: 1 });
  assert.equal(presenceFor(p, null), p, "stable while exiting");
  const reopened = presenceFor(p, b);
  assert.deepEqual(reopened, { value: b, exiting: false, key: 2 });
  assert.equal(presenceExited(reopened), reopened, "a late exit timer doesn't close a new open");
  p = presenceExited(p);
  assert.deepEqual(p, { value: null, exiting: false, key: 1 });
  assert.equal(presenceFor(p, null), p);
  assert.equal(presenceFor(p, a).key, 2, "a fresh open of the same message remounts");
});
