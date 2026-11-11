import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchSheetLayout } from "../src/lib/searchSheetLayout.ts";

const frame = (height = 844, width = 390, visibleBottom = height, chromeHeight = 210) =>
  searchSheetLayout({ height, width, visibleBottom, chromeHeight });

test("portrait search keeps its top while only results shrink for the keyboard", () => {
  for (const width of [320, 360, 390, 430]) {
    const closed = frame(844, width);
    for (const keyboard of [0, 120, 280, 320, 380]) {
      const open = frame(844, width, 844 - keyboard);
      assert.equal(open.top, closed.top);
      assert.equal(open.bottom, 844 - keyboard);
      assert.ok(open.bottom - open.top >= 210 + 64);
    }
  }
});
test("desktop has bounded height and does not recenter when the keyboard opens", () => {
  const closed = frame(1000, 1440, 1000);
  assert.equal(closed.bottom - closed.top, 720);
  assert.equal(closed.top, 140);
  assert.equal(frame(1000, 1440, 650).top, closed.top);
});
test("short screens and larger chrome move only as far as necessary", () => {
  const landscape = frame(390, 844, 250, 170);
  assert.equal(landscape.top, 16);
  const largeText = frame(667, 320, 367, 290);
  assert.equal(largeText.top, 13);
  assert.equal(largeText.bottom - largeText.top, 354);
});
test("keyboard retargeting is deterministic and close returns the original frame", () => {
  const closed = frame();
  const open = frame(844, 390, 524);
  assert.deepEqual(frame(844, 390, 484), { top: closed.top, bottom: 484 });
  assert.deepEqual(frame(), closed);
  assert.deepEqual(frame(844, 390, 524), open);
});
test("viewport bounds remain finite for hidden, tiny and invalid samples", () => {
  for (const height of [0, 100, 390, NaN, Infinity]) {
    for (const bottom of [0, -1, 100, 900, NaN, Infinity]) {
      const result = frame(height, 320, bottom);
      assert.ok(Number.isFinite(result.top) && Number.isFinite(result.bottom));
      assert.ok(result.top >= 0 && result.bottom >= result.top);
      if (Number.isFinite(height)) assert.ok(result.bottom <= height);
    }
  }
});
test("the connection search opts in without changing native/chat event ownership", () => {
  const source = readFileSync(new URL("../src/components/profile/ProfileFollowers.tsx", import.meta.url), "utf8");
  assert.match(source, /<SearchModal[^>]+searchHeader=/);
  const hook = readFileSync(new URL("../src/lib/useSearchSheetLayout.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /scrollIntoView|window\.scroll|Keyboard\.addListener/);
  assert.match(hook, /observer\?\.disconnect\(\)/);
  assert.match(hook, /removeEventListener\("resize", update\)/);
  assert.match(hook, /removeEventListener\("focusout", update\)/);
});
