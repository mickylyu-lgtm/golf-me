// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { clubLabel, parseClub } from "../src/lib/clubLabel.ts";
import { ALL_CLUB_VALUES, CLUBS_BY_CATEGORY, CLUB_CATEGORIES, clubAfterCardTap, clubCategoryOf, isCatalogClub, onlyClubIn, restoredDraftClub } from "../src/lib/clubCatalog.ts";
import { analysisBlocker } from "../src/lib/trimReopen.ts";
import type { ClubCategory } from "../src/lib/clubCatalog.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";

const tFor = (dict: Record<string, string>) => (key: string, vars: Record<string, string | number> = {}) =>
  dict[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

const LOCALES = { en, es, zhCN, zhTW, ja, ko } as unknown as Record<string, Record<string, string>>;

test("parses the picker's clubs and older typed ones", () => {
  assert.deepEqual(parseClub("Driver"), { kind: "driver" });
  assert.deepEqual(parseClub("Mini Driver"), { kind: "miniDriver" });
  assert.deepEqual(parseClub("5 Wood"), { kind: "wood", n: 5 });
  assert.deepEqual(parseClub("3 hybrid"), { kind: "hybrid", n: 3 });
  assert.deepEqual(parseClub(" 7  Iron "), { kind: "iron", n: 7 });
  assert.deepEqual(parseClub("7iron"), { kind: "iron", n: 7 });
  assert.deepEqual(parseClub("Pitching Wedge"), { kind: "pitchingWedge" });
  assert.deepEqual(parseClub("Gap Wedge"), { kind: "gapWedge" });
  assert.deepEqual(parseClub("  sand wedge "), { kind: "sandWedge" });
  assert.deepEqual(parseClub("Lob Wedge"), { kind: "lobWedge" });
  assert.deepEqual(parseClub("56° Wedge"), { kind: "wedge", degrees: 56 });
  assert.deepEqual(parseClub("56 wedge"), { kind: "wedge", degrees: 56 });
  for (const other of ["", "Putter", "my new driver", "7 iron chip", null, undefined]) assert.equal(parseClub(other), null, String(other));
});

test("labels follow the app language; unknown names stay as stored", () => {
  const zh = tFor(LOCALES.zhCN);
  const jp = tFor(LOCALES.ja);
  const e = tFor(LOCALES.en);
  assert.equal(clubLabel("Driver", e), "Driver");
  assert.equal(clubLabel("5 Wood", e), "5 Wood");
  assert.equal(clubLabel("56° Wedge", e), "56° Wedge");
  assert.equal(clubLabel("7 Iron", zh), "7号铁");
  assert.equal(clubLabel("Driver", zh), "一号木");
  assert.equal(clubLabel("3 Hybrid", jp), "3番ユーティリティ");
  assert.equal(clubLabel("  Sand Wedge ", zh), "沙坑挖起杆");
  assert.equal(clubLabel("Mini Driver", jp), "ミニドライバー");
  assert.equal(clubLabel("Putter", zh), "Putter");
  assert.equal(clubLabel(undefined, zh), "");
});

// Every value the old <select> offered (until 2026-11-06). Stored in
// caddie_analyses.swing_type and in drafts, so none may change or vanish.
const OLD_DROPDOWN = [
  "Driver", "3 Wood", "5 Wood", "7 Wood", "9 Wood", "2 Hybrid", "3 Hybrid", "4 Hybrid", "5 Hybrid",
  "1 Iron", "2 Iron", "3 Iron", "4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron",
  "Pitching Wedge", "52° Wedge", "54° Wedge", "56° Wedge", "58° Wedge", "60° Wedge",
];

test("the picker keeps every old value exactly, adds the new ones, and has no putter", () => {
  for (const v of OLD_DROPDOWN) assert.ok(ALL_CLUB_VALUES.includes(v), v);
  for (const v of ["Mini Driver", "2 Wood", "4 Wood", "6 Hybrid", "7 Hybrid", "Gap Wedge", "Sand Wedge", "Lob Wedge", "46° Wedge", "50° Wedge", "62° Wedge", "64° Wedge"]) {
    assert.ok(ALL_CLUB_VALUES.includes(v), v);
  }
  assert.equal(new Set(ALL_CLUB_VALUES).size, ALL_CLUB_VALUES.length, "no duplicates");
  assert.ok(!ALL_CLUB_VALUES.some((v) => /putt/i.test(v)), "no putter");
  assert.deepEqual(CLUBS_BY_CATEGORY.wedge.slice(4), ["46° Wedge", "48° Wedge", "50° Wedge", "52° Wedge", "54° Wedge", "56° Wedge", "58° Wedge", "60° Wedge", "62° Wedge", "64° Wedge"]);
});

test("every picker value parses, sits in its own card, and is translated in all 6 locales", () => {
  for (const category of CLUB_CATEGORIES) {
    for (const v of CLUBS_BY_CATEGORY[category]) {
      assert.ok(parseClub(v), `${v} parses`);
      assert.equal(clubCategoryOf(v), category, v);
    }
  }
  for (const [name, dict] of Object.entries(LOCALES)) {
    const t = tFor(dict);
    for (const v of ALL_CLUB_VALUES) {
      const label = clubLabel(v, t);
      assert.ok(label && !label.includes("{"), `${name}: ${v} -> ${label}`);
      assert.doesNotMatch(label, /\p{Extended_Pictographic}/u, `${name}: ${v} has an emoji`);
    }
    for (const key of ["club.category.driver", "club.category.wood", "club.category.hybrid", "club.category.iron", "club.category.wedge", "caddie.club.notSure", "caddie.club.typeLabel", "caddie.club.requiredLabel", "caddie.club.pickExact", "caddie.club.chooseToContinue"]) {
      assert.ok(dict[key]?.trim(), `${name}: ${key}`);
      assert.doesNotMatch(dict[key], /\p{Extended_Pictographic}/u, `${name}: ${key} has an emoji`);
    }
  }
  assert.equal(clubCategoryOf("3 wood"), "wood", "older typed values still find their card");
  assert.equal(clubCategoryOf("Putter"), null);
  assert.equal(clubCategoryOf(""), null);
});

test("onlyClubIn: a card picks a club by itself only when its category has exactly one", () => {
  // Today every category offers a choice (Driver has Driver and Mini Driver): no card auto-selects.
  for (const category of CLUB_CATEGORIES) {
    assert.ok(CLUBS_BY_CATEGORY[category].length > 1, `${category} has several clubs`);
    assert.equal(onlyClubIn(category), null, category);
  }
  // The rule itself, on a made-up catalog.
  const catalog: Record<ClubCategory, readonly string[]> = {
    driver: ["Driver"],
    wood: ["3 Wood", "5 Wood"],
    hybrid: [],
    iron: ["7 Iron"],
    wedge: ["Pitching Wedge", "Sand Wedge"],
  };
  assert.equal(onlyClubIn("driver", catalog), "Driver");
  assert.equal(onlyClubIn("iron", catalog), "7 Iron");
  assert.equal(onlyClubIn("wood", catalog), null, "never a default in a multi-option category");
  assert.equal(onlyClubIn("wedge", catalog), null);
  assert.equal(onlyClubIn("hybrid", catalog), null, "an empty category picks nothing");
});

test("first-time Driver: the card opens Driver / Mini Driver, one chip tap picks, nothing clears it", () => {
  // Fresh screen, no club: tapping the Driver card picks nothing by itself (two options)...
  let value = restoredDraftClub(undefined);
  assert.equal(value, "");
  value = clubAfterCardTap("driver", value);
  assert.equal(value, "", "no default between Driver and Mini Driver");
  assert.deepEqual([...CLUBS_BY_CATEGORY.driver], ["Driver", "Mini Driver"]);
  // ...the first chip tap is the pick, and it satisfies the requirement at once.
  value = "Driver";
  assert.equal(isCatalogClub(value), true);
  assert.equal(analysisBlocker({ hasVideo: true, hasClub: isCatalogClub(value), submitting: false, selectorOpen: false, reopening: false }), null);
  // Re-tapping the Driver card afterwards keeps it (no second selection needed).
  assert.equal(clubAfterCardTap("driver", value), "Driver");
  assert.equal(clubAfterCardTap("driver", "Mini Driver"), "Mini Driver");
});

test("changing clubs: another card clears the club; same card keeps it", () => {
  assert.equal(clubAfterCardTap("iron", "Driver"), "", "a Driver is not an iron");
  assert.equal(clubAfterCardTap("wedge", "7 Iron"), "");
  assert.equal(clubAfterCardTap("iron", "7 Iron"), "7 Iron");
  assert.equal(clubAfterCardTap("wedge", "56° Wedge"), "56° Wedge");
  assert.equal(clubAfterCardTap("wood", ""), "");
  // With a one-club category the card itself picks that club, replacing any other.
  const catalog = { ...CLUBS_BY_CATEGORY, driver: ["Driver"] };
  assert.equal(clubAfterCardTap("driver", "7 Iron", catalog), "Driver");
  assert.equal(clubAfterCardTap("driver", "", catalog), "Driver");
});

test("returning with a saved draft: a catalog club and its card come back; anything else is missing", () => {
  for (const v of ["Driver", "Mini Driver", "7 Iron", "Pitching Wedge", "52° Wedge", "3 Wood", "4 Hybrid"]) {
    assert.equal(restoredDraftClub(v), v);
    assert.ok(clubCategoryOf(restoredDraftClub(v)), `${v} reopens its card`);
  }
  for (const v of ["Putter", "3 wood", "Not sure", "", null, undefined]) {
    const restored = restoredDraftClub(v);
    assert.equal(restored, "", String(v));
    assert.equal(clubCategoryOf(restored), null, "no card opens for a stale value");
    // Missing club with a video: Ask Caddie disabled, and the reason is the club.
    assert.equal(analysisBlocker({ hasVideo: true, hasClub: isCatalogClub(restored), submitting: false, selectorOpen: false, reopening: false }), "noClub");
  }
});

test("isCatalogClub: only a club the picker offers satisfies the requirement", () => {
  for (const v of ALL_CLUB_VALUES) assert.equal(isCatalogClub(v), true, v);
  // Stale or unknown saved values read as "no club".
  for (const v of ["", " ", "Putter", "3 wood", "7 iron ", "Driver ", "Not sure", "8 Wood", "70° Wedge", null, undefined]) {
    assert.equal(isCatalogClub(v), false, String(v));
  }
});
