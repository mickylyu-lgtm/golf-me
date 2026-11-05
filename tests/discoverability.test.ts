// Run: npm run test:trust  (node --test, built-in type stripping)
// Pure rules behind Settings -> Discoverable (src/lib/discoverability.ts).
// Synthetic ids only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverableCandidates, discoverableSetting } from "../src/lib/discoverability.ts";

test("the Settings switch is unavailable without a row or without the column", () => {
  assert.equal(discoverableSetting(null), "unavailable");
  assert.equal(discoverableSetting(undefined), "unavailable");
  assert.equal(discoverableSetting({ id: "me", name: "Me" }), "unavailable");
  assert.equal(discoverableSetting({ id: "me", discoverable: true }), "on");
  assert.equal(discoverableSetting({ id: "me", discoverable: false }), "off");
});

test("Golfers list: directory ids only, minus self and blocks either way", () => {
  const cache = new Map([
    ["me", { id: "me" }],
    ["a", { id: "a" }],
    ["b", { id: "b" }],
    ["blocked", { id: "blocked" }],
    // A hidden follower: in the cache (connected), never in the directory.
    ["hidden-follower", { id: "hidden-follower" }],
  ]);
  const ids = ["me", "a", "b", "blocked", "not-cached"];
  const out = discoverableCandidates(ids, cache, "me", new Set(["blocked"]));
  assert.deepEqual(
    out.map((g) => g.id),
    ["a", "b"],
  );
  assert.equal(out.some((g) => g.id === "hidden-follower"), false);
});
