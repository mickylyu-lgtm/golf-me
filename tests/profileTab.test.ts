import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILE_TABS, isProfileTab, profileTabPath, resolveProfileTab } from "../src/lib/profileTab.ts";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("an explicit, valid tab param beats the remembered tab", () => {
  assert.equal(resolveProfileTab("posts", "rounds"), "posts");
  assert.equal(resolveProfileTab("swings", "posts"), "swings");
});

test("no param, or a junk one, keeps the remembered tab", () => {
  assert.equal(resolveProfileTab(null, "swings"), "swings");
  assert.equal(resolveProfileTab("", "posts"), "posts");
  assert.equal(resolveProfileTab("ROUNDS", "posts"), "posts");
  assert.equal(isProfileTab("circle"), false);
  assert.deepEqual([...PROFILE_TABS], ["rounds", "swings", "posts"]);
});

test("tab paths stay on the /profile root route", () => {
  assert.equal(profileTabPath("rounds"), "/profile?tab=rounds");
  assert.equal(new URL(profileTabPath("posts"), "https://golfme.app").pathname, "/profile");
});

test("old Me sub-page URLs redirect to the matching tab instead of 404ing", () => {
  const app = read("src/App.tsx");
  assert.match(app, /path="\/my-rounds" element=\{<Navigate to=\{profileTabPath\("rounds"\)\} replace \/>\}/);
  assert.match(app, /path="\/profile\/posts" element=\{<Navigate to=\{profileTabPath\("posts"\)\} replace \/>\}/);
  assert.match(app, /path="\/saved-posts" element=\{<SavedPosts \/>\}/);
});

test("Me links to Reputation once, from the header tier badge", () => {
  const profile = read("src/pages/Profile.tsx");
  assert.equal((profile.match(/navigate\("\/profile\/reputation"\)/g) ?? []).length, 1);
});
