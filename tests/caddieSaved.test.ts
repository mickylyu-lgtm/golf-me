// Run: npm run test:caddie  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_SAVED_KEY,
  SAVED_CATEGORIES,
  SAVED_FILTER_KEYS,
  canSaveAnalysis,
  filterSaved,
  isMissingSavedColumn,
  loadDemoSaved,
  savedAnalyses,
  savedCategoryOf,
  savedCounts,
  storeDemoSaved,
  visibleSavedFilters,
} from "../src/lib/caddieSaved.ts";
import { CLUB_CATEGORIES } from "../src/lib/clubCatalog.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";

const LOCALES = { en, es, zhCN, zhTW, ja, ko } as unknown as Record<string, Record<string, string>>;

const row = (id: string, swingType: string | undefined, savedAt: string | undefined, status = "complete") => ({ id, swingType, savedAt, status });

test("categories follow the club picker's cards, plus Other", () => {
  assert.deepEqual(SAVED_CATEGORIES, [...CLUB_CATEGORIES, "other"]);
  assert.equal(savedCategoryOf("Driver"), "driver");
  assert.equal(savedCategoryOf("Mini Driver"), "driver");
  assert.equal(savedCategoryOf("3 Wood"), "wood");
  assert.equal(savedCategoryOf("4 hybrid"), "hybrid");
  assert.equal(savedCategoryOf("7 Iron"), "iron");
  assert.equal(savedCategoryOf("Sand Wedge"), "wedge");
  assert.equal(savedCategoryOf("56° Wedge"), "wedge");
  // No club ("Not sure" sends none), or something typed that isn't a club.
  assert.equal(savedCategoryOf(undefined), "other");
  assert.equal(savedCategoryOf(""), "other");
  assert.equal(savedCategoryOf("Putter"), "other");
  assert.equal(savedCategoryOf("my swing"), "other");
});

test("only complete analyses are saveable and listed, newest save first", () => {
  assert.equal(canSaveAnalysis({ status: "complete" }), true);
  for (const s of ["processing", "failed", "pending"]) assert.equal(canSaveAnalysis({ status: s }), false);
  const list = savedAnalyses([
    row("a", "Driver", "2026-11-01T10:00:00Z"),
    row("b", "7 Iron", undefined),
    row("c", "7 Iron", "2026-11-03T10:00:00Z"),
    row("d", "Driver", "2026-11-04T10:00:00Z", "failed"),
    row("e", undefined, "2026-11-02T10:00:00Z"),
  ]);
  assert.deepEqual(list.map((a) => a.id), ["c", "e", "a"]);
});

test("counts, visible chips and filtering", () => {
  const saved = savedAnalyses([
    row("a", "Driver", "2026-11-01T10:00:00Z"),
    row("b", "Mini Driver", "2026-11-02T10:00:00Z"),
    row("c", "7 Iron", "2026-11-03T10:00:00Z"),
    row("d", undefined, "2026-11-04T10:00:00Z"),
  ]);
  const counts = savedCounts(saved);
  assert.deepEqual(counts, { all: 4, driver: 2, wood: 0, hybrid: 0, iron: 1, wedge: 0, other: 1 });
  // Empty categories are hidden; order follows the picker, Other last.
  assert.deepEqual(visibleSavedFilters(counts), ["all", "driver", "iron", "other"]);
  assert.deepEqual(filterSaved(saved, "driver").map((a) => a.id), ["b", "a"]);
  assert.deepEqual(filterSaved(saved, "other").map((a) => a.id), ["d"]);
  assert.deepEqual(filterSaved(saved, "wedge"), []);
  assert.equal(filterSaved(saved, "all").length, 4);
  assert.deepEqual(visibleSavedFilters(savedCounts([])), ["all"]);
});

test("feature detection: only a missing saved_at column counts", () => {
  assert.equal(isMissingSavedColumn({ code: "42703", message: "column caddie_analyses.saved_at does not exist" }), true);
  assert.equal(isMissingSavedColumn({ code: "PGRST204", message: "Could not find the 'saved_at' column" }), true);
  assert.equal(isMissingSavedColumn({ code: "42703", message: "column caddie_analyses.attempt does not exist" }), false);
  assert.equal(isMissingSavedColumn({ code: "42501", message: "saved_at" }), false);
  assert.equal(isMissingSavedColumn(null), false);
});

test("demo saves: round trip, junk and unavailable storage", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  assert.deepEqual(loadDemoSaved(storage), {});
  storeDemoSaved(storage, { "demo-caddie-1": "2026-11-06T10:00:00.000Z" });
  assert.deepEqual(loadDemoSaved(storage), { "demo-caddie-1": "2026-11-06T10:00:00.000Z" });
  storeDemoSaved(storage, {});
  assert.equal(mem.has(DEMO_SAVED_KEY), false);
  mem.set(DEMO_SAVED_KEY, "{not json");
  assert.deepEqual(loadDemoSaved(storage), {});
  mem.set(DEMO_SAVED_KEY, JSON.stringify({ ok: "2026-11-06T10:00:00Z", bad: 5, worse: "nope" }));
  assert.deepEqual(loadDemoSaved(storage), { ok: "2026-11-06T10:00:00Z" });
  mem.set(DEMO_SAVED_KEY, "[1,2]");
  assert.deepEqual(loadDemoSaved(storage), {});
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadDemoSaved(throwing), {});
  assert.doesNotThrow(() => storeDemoSaved(throwing, { a: "2026-11-06T10:00:00Z" }));
  assert.deepEqual(loadDemoSaved(undefined), {});
});

const SAVED_KEYS = [
  "caddie.saved.title",
  "caddie.saved.save",
  "caddie.saved.saved",
  "caddie.saved.saveLabel",
  "caddie.saved.empty",
  "caddie.saved.saveFailed",
  "caddie.saved.unsaveFailed",
  "caddie.saved.filterLabel",
  ...Object.values(SAVED_FILTER_KEYS),
];

test("every locale has the Saved swings strings, with no emoji", () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const key of SAVED_KEYS) {
      assert.equal(typeof dict[key], "string", `${name} is missing ${key}`);
      assert.ok(dict[key].trim().length > 0, `${name} ${key} is empty`);
      assert.ok(!emoji.test(dict[key]), `${name} ${key} has an emoji`);
    }
  }
});

test("migration: owner-checked definer RPC, complete-only check, partial index", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261107210000_caddie_saved_swings.sql", import.meta.url), "utf8");
  assert.match(sql, /add column saved_at timestamptz;/);
  assert.match(sql, /check \(saved_at is null or status = 'complete'\)/);
  assert.match(sql, /on public\.caddie_analyses \(owner_id, saved_at desc\)\s+where saved_at is not null/);
  assert.match(sql, /create function public\.set_caddie_analysis_saved\(p_analysis_id uuid, p_saved boolean\)[\s\S]*security definer\s+set search_path = ''/);
  assert.match(sql, /v_owner is distinct from v_uid/);
  assert.match(sql, /revoke execute on function public\.set_caddie_analysis_saved\(uuid, boolean\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.set_caddie_analysis_saved\(uuid, boolean\) to authenticated;/);
  // The RPC writes saved_at and nothing else.
  const updates = [...sql.matchAll(/update public\.caddie_analyses a\s+set ([^;]+?)\s+where/g)].map((m) => m[1].trim());
  assert.deepEqual(updates, ["saved_at = v_next"]);
});
