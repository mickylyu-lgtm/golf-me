// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenFlag, isSortMode, parseVibes, serializeVibes, toggleVibe } from "../src/lib/discoverFilters.ts";

test("vibe selection round-trips through its stored string", () => {
  const picked = toggleVibe(toggleVibe([], "Competitive"), "Casual & Social");
  assert.deepEqual(parseVibes(serializeVibes(picked)), ["Casual & Social", "Competitive"]);
  assert.deepEqual(parseVibes(serializeVibes([])), []);
  assert.deepEqual(toggleVibe(picked, "Competitive"), ["Casual & Social"]);
});

test("stale or junk stored values are ignored", () => {
  assert.deepEqual(parseVibes("Competitive|Nope|Competitive"), ["Competitive"]);
  assert.deepEqual(parseVibes(""), []);
  assert.equal(isSortMode("distance"), true);
  assert.equal(isSortMode("random"), false);
  assert.equal(isOpenFlag("1"), true);
  assert.equal(isOpenFlag("true"), false);
});
