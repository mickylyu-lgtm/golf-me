// Run: npm run test:trust  (node --test, built-in type stripping)
// Settings must not offer a privacy or email control that nothing saves or
// enforces (Micky, 2026-11-04). "Discoverable to nearby golfers" promised to
// hide a profile from Discover and matches, and "Email updates" a weekly
// digest; both were local useState only, with no column, no discovery
// filter and no digest sender. If a real version comes back, it must arrive
// with its migration, server-side enforcement and its own tests, and this
// test changes with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const settingsSource = readFileSync(new URL("../src/pages/Settings.tsx", import.meta.url), "utf8");
const LOCALES = { en, es, ja, ko, zhCN, zhTW } as Record<string, Record<string, string>>;
const REMOVED_KEYS = ["settings.discoverable", "settings.discoverableDesc", "settings.emailUpdates", "settings.emailUpdatesDesc"];

test("Settings has no unenforced Discoverable or Email updates switch", () => {
  for (const marker of ["profileDiscoverable", "emailEnabled", "settings.discoverable", "settings.emailUpdates"]) {
    assert.equal(settingsSource.includes(marker), false, `Settings.tsx still references ${marker}`);
  }
});

test("the removed promises are gone from every language", () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const key of REMOVED_KEYS) assert.equal(key in dict, false, `${name} still has ${key}`);
  }
});

test("every language has the accurate visibility note, and it promises no hiding", () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    const note = dict["settings.profileVisibilityNote"];
    assert.ok(note && note.trim().length > 0, `${name} is missing settings.profileVisibilityNote`);
  }
  assert.match(en["settings.profileVisibilityNote"], /block/i, "points to the control that really exists");
  assert.doesNotMatch(en["settings.profileVisibilityNote"], /hid(e|den)|invisible|private profile/i);
  assert.equal(settingsSource.includes('t("settings.profileVisibilityNote")'), true);
});
