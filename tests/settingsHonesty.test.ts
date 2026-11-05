// Run: npm run test:trust  (node --test, built-in type stripping)
// Settings must not offer a privacy or email control that nothing saves or
// enforces (Micky, 2026-11-04). "Email updates" promised a weekly digest
// that doesn't exist (local useState only) and stays removed.
// "Discoverable" came back as a real setting: profiles.discoverable, saved
// through saveProfile, enforced by the database (migration 20261106120000:
// golfer_directory, search + suggestion RPCs, new-round alert trigger).
// These checks fail if the switch ever goes back to local-only state, or its
// copy starts promising more than the server does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const settingsSource = read("../src/pages/Settings.tsx");
const migration = read("../supabase/migrations/20261106120000_add_public_golfer_directory.sql");
const LOCALES = { en, es, ja, ko, zhCN, zhTW } as Record<string, Record<string, string>>;
const REMOVED_KEYS = ["settings.emailUpdates", "settings.emailUpdatesDesc"];
const DISCOVERABLE_KEYS = [
  "settings.discoverable",
  "settings.discoverableDesc",
  "settings.discoverableOffNote",
  "settings.discoverableSaving",
  "settings.discoverableSaveFailed",
  "settings.discoverableDemoNote",
];

// The SQL without comments, so a filter mentioned only in the header can't
// satisfy these checks.
const sql = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function functionBody(name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `migration defines ${name}`);
  const bodyStart = sql.indexOf("as $", start);
  const ends = ["$$;", "$function$;"].map((d) => sql.indexOf(d, bodyStart)).filter((i) => i >= 0);
  return sql.slice(start, Math.min(...ends));
}

test("Settings has no unenforced Email updates switch", () => {
  for (const marker of ["emailEnabled", "settings.emailUpdates"]) {
    assert.equal(settingsSource.includes(marker), false, `Settings.tsx still references ${marker}`);
  }
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const key of REMOVED_KEYS) assert.equal(key in dict, false, `${name} still has ${key}`);
  }
});

test("the Discoverable switch is saved to the profile, not kept in local state for real accounts", () => {
  assert.match(settingsSource, /saveProfile\(\{ discoverable: value \}\)/);
  assert.match(settingsSource, /discoverableSetting\(profileRow/);
  assert.match(settingsSource, /isDemo \? demoDiscoverable : discoverableSaved === "on"/);
  assert.equal(settingsSource.includes("profileDiscoverable"), false, "the old useState switch is gone");
  assert.match(settingsSource, /settings\.discoverableSaving/);
  assert.match(settingsSource, /settings\.discoverableSaveFailed/);
});

test("the database enforces it: column default true, every discovery path filters it", () => {
  assert.match(sql, /add column discoverable boolean not null default true/);
  assert.match(functionBody("golfer_directory"), /and p\.discoverable\b/);
  assert.match(functionBody("search_golfer_profiles"), /and p\.discoverable\b/);
  assert.match(functionBody("suggested_golfer_profiles"), /and p\.discoverable\b/);
  assert.match(sql, /when \(new\.type = 'new_round_nearby' and new\.actor_id is not null\)/);
  // No UPDATE of existing rows: nobody's visibility changes silently.
  assert.doesNotMatch(sql, /update public\.profiles/i);
  // Phase 1 leaves the table policy alone (phase 2 is its own migration).
  assert.doesNotMatch(sql, /policy/i);
});

test("every language has the Discoverable copy, and none of it promises a private profile", () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const key of DISCOVERABLE_KEYS) assert.ok(dict[key]?.trim(), `${name} is missing ${key}`);
  }
  assert.match(en["settings.discoverableDesc"], /Golfers/);
  assert.match(en["settings.discoverableOffNote"], /search/);
  assert.match(en["settings.discoverableOffNote"], /can still see your profile/);
  for (const key of DISCOVERABLE_KEYS) assert.doesNotMatch(en[key], /private|invisible|nobody can/i, key);
});

test("the visibility note stays accurate and promises no hiding", () => {
  for (const [name, dict] of Object.entries(LOCALES)) {
    const note = dict["settings.profileVisibilityNote"];
    assert.ok(note && note.trim().length > 0, `${name} is missing settings.profileVisibilityNote`);
  }
  assert.match(en["settings.profileVisibilityNote"], /block/i, "points to the control that really exists");
  assert.doesNotMatch(en["settings.profileVisibilityNote"], /hid(e|den)|invisible|private profile/i);
  assert.equal(settingsSource.includes('t("settings.profileVisibilityNote")'), true);
});
