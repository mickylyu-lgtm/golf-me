// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeNavIndex, isNavPathActive } from "../src/lib/navMatch.ts";

// Same order as nav.ts NAV_ITEMS (nav.ts itself imports icons, so the paths
// are restated here).
const ITEMS = [{ path: "/" }, { path: "/messages" }, { path: "/find" }, { path: "/caddie" }, { path: "/profile" }];
const PLAY = 2;

const PLAY_ROUTES = [
  "/find",
  "/golf-calls",
  "/golf-calls/new",
  "/golf-calls/3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10",
  "/auto-match",
  "/discover",
  "/tee-times",
  "/tee-times/bethpage-black",
  "/courses/nearby",
  "/courses/abc123",
];

test("Play is active on every Play route", () => {
  for (const route of PLAY_ROUTES) {
    assert.equal(activeNavIndex(ITEMS, route), PLAY, route);
    assert.equal(isNavPathActive("/find", route), true, route);
    assert.equal(isNavPathActive("/", route), false, `Home not also lit on ${route}`);
  }
});

test("other tabs keep their own routes", () => {
  assert.equal(activeNavIndex(ITEMS, "/"), 0);
  assert.equal(activeNavIndex(ITEMS, "/messages"), 1);
  assert.equal(activeNavIndex(ITEMS, "/messages/abc"), 1);
  assert.equal(activeNavIndex(ITEMS, "/caddie"), 3);
  assert.equal(activeNavIndex(ITEMS, "/caddie/analyze"), 3);
  assert.equal(activeNavIndex(ITEMS, "/caddie/123"), 3);
  for (const me of ["/profile", "/profile/reputation", "/profile/following/find", "/settings", "/settings/language", "/help", "/about", "/my-rounds", "/saved-posts", "/coach-reviews"]) {
    assert.equal(activeNavIndex(ITEMS, me), 4, me);
  }
});

test("ambiguous routes belong to no tab (callers keep their fallback)", () => {
  for (const route of ["/golfer/abc", "/community", "/community/123", "/admin/dashboard"]) {
    assert.equal(activeNavIndex(ITEMS, route), -1, route);
  }
});

test("prefixes match whole path segments only", () => {
  assert.equal(isNavPathActive("/find", "/findx"), false);
  assert.equal(isNavPathActive("/find", "/golf-callsx"), false);
  assert.equal(isNavPathActive("/profile", "/profiles"), false);
  assert.equal(isNavPathActive("/", "/find"), false);
});
