// Run: npm run test:caddie  (node --test, built-in type stripping)
// Caddie's feedback language is its own preference (Micky, 2026-11-05,
// option B): picking it never changes the app's language, and changing the
// app's language never changes an explicit pick.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_LOCALE_KEY = "golfme:locale"; // LocaleContext's LOCALE_STORAGE_KEY

class FakeStorage {
  map = new Map<string, string>();
  writes: string[] = [];
  broken = false;
  getItem(k: string) {
    if (this.broken) throw new Error("blocked");
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.broken) throw new Error("blocked");
    this.writes.push(k);
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

const mod = await import("../src/lib/caddieFeedbackLanguage.ts");
const { CADDIE_FEEDBACK_LANGUAGE_KEY, caddieFeedbackLanguage, setCaddieFeedbackLanguage, storedCaddieFeedbackLanguage, subscribeCaddieFeedbackLanguage } = mod;

beforeEach(() => {
  storage.map.clear();
  storage.writes = [];
  storage.broken = false;
});

test("with no pick it follows the app language", () => {
  assert.equal(storedCaddieFeedbackLanguage(), null);
  assert.equal(caddieFeedbackLanguage("ja"), "ja");
  assert.equal(caddieFeedbackLanguage("en"), "en");
});

test("picking a feedback language leaves the app locale unchanged", () => {
  storage.map.set(APP_LOCALE_KEY, "en");
  setCaddieFeedbackLanguage("es");
  assert.equal(caddieFeedbackLanguage("en"), "es");
  assert.equal(storage.map.get(APP_LOCALE_KEY), "en");
  assert.deepEqual(storage.writes, [CADDIE_FEEDBACK_LANGUAGE_KEY]);
});

test("changing the app locale leaves an explicit feedback language unchanged", () => {
  setCaddieFeedbackLanguage("ko");
  storage.map.set(APP_LOCALE_KEY, "zh-TW"); // what LocaleProvider writes on setLocale
  assert.equal(caddieFeedbackLanguage("zh-TW"), "ko");
  assert.equal(storage.map.get(CADDIE_FEEDBACK_LANGUAGE_KEY), "ko");
});

test("unknown values are ignored", () => {
  setCaddieFeedbackLanguage("fr");
  assert.equal(storedCaddieFeedbackLanguage(), null);
  storage.map.set(CADDIE_FEEDBACK_LANGUAGE_KEY, "klingon");
  assert.equal(caddieFeedbackLanguage("en"), "en");
});

test("blocked storage keeps the pick for this page", () => {
  storage.broken = true;
  setCaddieFeedbackLanguage("zh-CN");
  assert.equal(caddieFeedbackLanguage("en"), "zh-CN");
});

test("subscribers hear a pick", () => {
  let calls = 0;
  const off = subscribeCaddieFeedbackLanguage(() => calls++);
  setCaddieFeedbackLanguage("ja");
  off();
  setCaddieFeedbackLanguage("en");
  assert.equal(calls, 1);
});

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("the Caddie picker sets only the feedback language, never the app locale", () => {
  const src = read("../src/pages/Caddie.tsx");
  assert.doesNotMatch(src, /setLocale\s*\(/);
  assert.match(src, /setCaddieFeedbackLanguage\(next\)/);
  assert.match(src, /value=\{feedbackLanguage\}/);
});

test("the app language setting never touches the feedback language", () => {
  for (const f of ["../src/pages/LanguageSettings.tsx", "../src/i18n/LocaleContext.tsx", "../src/App.tsx"]) {
    assert.doesNotMatch(read(f), /caddieFeedbackLanguage|CaddieFeedbackLanguage/, f);
  }
});

test("new analyses and translations ask for the feedback language", () => {
  assert.match(read("../src/context/RealCaddieContext.tsx"), /locale: caddieFeedbackLanguage\(locale\)/);
  const detail = read("../src/pages/CaddieAnalysisDetail.tsx");
  assert.match(detail, /const locale = useCaddieFeedbackLanguage\(\)/);
  assert.match(detail, /translateCaddieAnalysis\(id, locale\)/);
});
