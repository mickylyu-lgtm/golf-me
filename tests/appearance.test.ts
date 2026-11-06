// Run: npm run test:trust  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  THEME_COLOR,
  effectiveScheme,
  parseAppearance,
  readAppearance,
  resolveScheme,
  writeAppearance,
} from "../src/lib/appearance.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

test("light and dark ignore the system; system follows it", () => {
  assert.equal(resolveScheme("light", true), "light");
  assert.equal(resolveScheme("light", false), "light");
  assert.equal(resolveScheme("dark", false), "dark");
  assert.equal(resolveScheme("dark", true), "dark");
  assert.equal(resolveScheme("system", true), "dark");
  assert.equal(resolveScheme("system", false), "light");
});

test("a forced-light screen (the landing page) wins over every setting", () => {
  for (const s of ["light", "dark", "system"] as const) for (const sys of [true, false]) assert.equal(effectiveScheme(s, sys, true), "light");
  assert.equal(effectiveScheme("dark", false, false), "dark");
});

test("unknown or missing stored values fall back to the default", () => {
  assert.equal(DEFAULT_APPEARANCE, "system");
  for (const v of [null, undefined, "", "Dark", "auto", 1, {}]) assert.equal(parseAppearance(v), DEFAULT_APPEARANCE);
  for (const v of ["light", "dark", "system"]) assert.equal(parseAppearance(v), v);
});

test("reads and writes the per-device key", () => {
  const s = memoryStorage();
  assert.equal(readAppearance(s), DEFAULT_APPEARANCE);
  assert.equal(writeAppearance(s, "dark"), true);
  assert.equal(s.data.get(APPEARANCE_STORAGE_KEY), "dark");
  assert.equal(readAppearance(s), "dark");
  assert.equal(readAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: "garbage" })), DEFAULT_APPEARANCE);
});

test("blocked or missing storage never throws", () => {
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readAppearance(throwing), DEFAULT_APPEARANCE);
  assert.equal(writeAppearance(throwing, "light"), false);
  assert.equal(readAppearance(null), DEFAULT_APPEARANCE);
  assert.equal(writeAppearance(undefined, "dark"), false);
});

test("index.html's pre-paint script uses the same key, values, default and dark colour", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`localStorage.getItem("${APPEARANCE_STORAGE_KEY}")`));
  assert.ok(html.includes(`s = "${DEFAULT_APPEARANCE}"`));
  assert.ok(html.includes(`"${THEME_COLOR.dark}"`));
  assert.ok(html.includes(`background: ${THEME_COLOR.dark}`));
  assert.ok(html.includes(`<meta name="theme-color" content="${THEME_COLOR.light}"`));
  assert.ok(html.includes('classList.contains("gm-static-landing")'), "landing stays light");
});
