// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTabPath, isFindTab, resolveFindTab } from "../src/lib/findTab.ts";

test("an explicit tab param picks the tab", () => {
  assert.equal(resolveFindTab("rounds", "rounds"), "rounds");
  assert.equal(resolveFindTab("golfers", "rounds"), "golfers");
});

test("the explicit param beats the remembered tab", () => {
  // Golfers was used last; Find a Round / View more / round-page Back ask for Rounds.
  assert.equal(resolveFindTab("rounds", "golfers"), "rounds");
});

test("no param, or a junk one, falls back to the remembered tab", () => {
  assert.equal(resolveFindTab(null, "golfers"), "golfers");
  assert.equal(resolveFindTab(undefined, "rounds"), "rounds");
  assert.equal(resolveFindTab("", "golfers"), "golfers");
  assert.equal(resolveFindTab("ROUNDS", "golfers"), "golfers");
  assert.equal(resolveFindTab("caddie", "rounds"), "rounds");
});

test("tab paths stay on the /find root route", () => {
  assert.equal(findTabPath("rounds"), "/find?tab=rounds");
  assert.equal(findTabPath("golfers"), "/find?tab=golfers");
  // RootTabCarousel/AppShell match ROOT_PATHS on pathname only.
  assert.equal(new URL(findTabPath("rounds"), "https://golfme.app").pathname, "/find");
  assert.equal(isFindTab("rounds"), true);
  assert.equal(isFindTab(null), false);
});
