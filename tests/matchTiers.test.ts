// Run: npm run test:play  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTier, preferenceTier, preferenceTierKey, PREFERENCE_TIER_KEYS, TIER_FOR_YOU_KEYS } from "../src/lib/matchTiers.ts";
import { evaluatePreferenceMatch } from "../src/lib/preferenceMatch.ts";
import type { NewPreferenceSelections, PreferenceMatchContext } from "../src/lib/preferenceMatch.ts";
import type { GolfCall, GolferProfile } from "../src/types/index.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const LOCALES: [string, Record<string, string>][] = [
  ["en", en],
  ["es", es],
  ["ja", ja],
  ["ko", ko],
  ["zh-CN", zhCN],
  ["zh-TW", zhTW],
];

test("compatibility tier boundaries", () => {
  assert.equal(matchTier(100).tier, "great");
  assert.equal(matchTier(80).tier, "great");
  assert.equal(matchTier(79.99).tier, "decent");
  assert.equal(matchTier(60).tier, "decent");
  assert.equal(matchTier(59.99).tier, "possible");
  assert.equal(matchTier(40).tier, "possible");
  assert.equal(matchTier(39.99).tier, "low");
  assert.equal(matchTier(0).tier, "low");
});

test("a missing compatibility score is the lowest tier, never a better one", () => {
  assert.equal(matchTier(Number.NaN).tier, "low");
  assert.equal(matchTier(undefined as unknown as number).tier, "low");
  assert.equal(matchTier(-5).tier, "low");
});

test("preference tier counts matched preferences", () => {
  assert.equal(preferenceTier(5), "excellent");
  assert.equal(preferenceTier(6), "excellent");
  assert.equal(preferenceTier(4), "great");
  assert.equal(preferenceTier(3), "good");
  assert.equal(preferenceTier(2), "none");
  assert.equal(preferenceTier(0), "none");
  assert.equal(preferenceTier(-1), "none");
  assert.equal(preferenceTier(Number.NaN), "none");
  assert.equal(preferenceTierKey("none"), null);
  assert.equal(preferenceTierKey("excellent"), "preferenceTier.excellent");
});

test("every preference tier label is translated in all 6 locales and names its dimension", () => {
  for (const [name, dict] of LOCALES) {
    const prefLabels = Object.values(PREFERENCE_TIER_KEYS).map((k) => dict[k]);
    const compatLabels = Object.values(TIER_FOR_YOU_KEYS).map((k) => dict[k]);
    for (const label of prefLabels) {
      assert.ok(label && label.trim().length > 0, `${name}: missing preference tier label`);
      // Never the same words as a compatibility verdict ("Great Match").
      assert.ok(!compatLabels.includes(label), `${name}: "${label}" reads like the compatibility tier`);
      assert.ok(!Object.values({ g: dict["matchTier.great"], d: dict["matchTier.decent"] }).includes(label), `${name}: "${label}" equals a badge label`);
    }
    assert.equal(new Set(prefLabels).size, 3, `${name}: preference tiers must be distinct`);
    if (name !== "en") assert.notEqual(dict["preferenceTier.excellent"], en["preferenceTier.excellent"], `${name}: left in English`);
    assert.ok(dict["autoMatch.preferenceTierHint"]?.trim(), `${name}: missing preference hint`);
  }
  assert.match(en["preferenceTier.excellent"], /preference/i);
  assert.match(en["preferenceTier.great"], /preference/i);
  assert.match(en["preferenceTier.good"], /preference/i);
});

// ── The desktop demo cases (review of c263079) ────────────────────────────
// Jordan (demo user) has all 5 Match Preferences set. Split Rock: 18 holes,
// stroke play, Networking vibe, a man host + a woman, nobody Jordan played
// with -> 5 of 5 preferences, while its compatibility score was in the
// "decent" band. Bethpage Red: 3 preferences, compatibility "great".
const JORDAN: NewPreferenceSelections = {
  roundLengthPreference: "18 Holes",
  genderPreference: "Prefer mixed group",
  groupTypePreference: "New Golfers",
  gameFormatPreference: "Standard Stroke Play",
  networkingPreference: "Open to Networking",
};
const CTX: PreferenceMatchContext = { followingIds: new Set(), circleIds: new Set(), playedWithIds: new Set() };
const golfer = (id: string, gender: string) => ({ id, gender }) as unknown as GolferProfile;
const call = (over: Partial<GolfCall>) => ({ holes: 18, gameFormat: "Standard Stroke Play", vibe: "Networking", ...over }) as GolfCall;

test("demo: 5/5 preferences with a decent compatibility score reads as two named dimensions", () => {
  const checks = evaluatePreferenceMatch(JORDAN, "me", call({}), [golfer("casey", "Man"), golfer("emily", "Woman")], CTX);
  const matched = checks.filter((c) => c.matched).length;
  assert.equal(matched, 5);
  assert.equal(preferenceTier(matched), "excellent");
  assert.equal(matchTier(70).tier, "decent");
  assert.equal(en[preferenceTierKey(preferenceTier(matched))!], "Excellent preference match");
  assert.equal(en[TIER_FOR_YOU_KEYS[matchTier(70).tier]], "Decent Match for you");
});

test("demo: 3 preferences with a great compatibility score", () => {
  // 9 holes and a casual vibe miss round length + networking.
  const checks = evaluatePreferenceMatch(JORDAN, "me", call({ holes: 9, vibe: "Casual & Social" }), [golfer("a", "Man"), golfer("b", "Woman")], CTX);
  const matched = checks.filter((c) => c.matched).length;
  assert.equal(matched, 3);
  assert.equal(en[preferenceTierKey(preferenceTier(matched))!], "Good preference match");
  assert.equal(en[TIER_FOR_YOU_KEYS[matchTier(85).tier]], "Great Match for you");
});

test("each selected preference appears exactly once in a round's check list", () => {
  const checks = evaluatePreferenceMatch(JORDAN, "me", call({}), [golfer("me", "Man"), golfer("casey", "Man"), golfer("emily", "Woman")], CTX);
  const keys = checks.map((c) => c.key);
  assert.equal(keys.length, 5);
  assert.equal(new Set(keys).size, keys.length);
});

test("unset preferences are left out, not shown as unmatched", () => {
  const one: NewPreferenceSelections = {
    roundLengthPreference: "18 Holes",
    genderPreference: "No preference",
    groupTypePreference: "No Preference",
    gameFormatPreference: "No Preference",
    networkingPreference: "No Preference",
  };
  const checks = evaluatePreferenceMatch(one, "me", call({}), [], CTX);
  assert.deepEqual(
    checks.map((c) => c.key),
    ["roundLength"],
  );
});

test("Auto-Match renders shared preferences once: the card's copy is turned off there", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/pages/AutoMatch.tsx", import.meta.url), "utf8");
  assert.match(src, /<GolfCallCard call=\{current\.call\} showSharedPreferences=\{false\} \/>/);
  assert.equal((src.match(/<SharedPreferencesBadge /g) ?? []).length, 1);
});
