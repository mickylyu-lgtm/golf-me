// Run: npm run test:caddie  (node --test, built-in type stripping)
// analysis_json.language and the "this feedback is in X" notice
// (src/lib/caddieLanguage.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisLanguageFromJson, showsLanguageNotice } from "../src/lib/caddieLanguage.ts";

test("analysisLanguageFromJson accepts only the six app locales", () => {
  for (const value of ["en", "es", "ja", "ko", "zh-CN", "zh-TW"]) assert.equal(analysisLanguageFromJson(value), value);
  for (const value of [undefined, null, "", "EN", "zh", "fr", "en-US", 1, {}]) assert.equal(analysisLanguageFromJson(value), undefined, String(value));
});

test("the notice shows only for a known, different language", () => {
  assert.equal(showsLanguageNotice("ja", "en"), true);
  assert.equal(showsLanguageNotice("zh-TW", "zh-CN"), true);
  assert.equal(showsLanguageNotice("en", "en"), false);
  // Rows from before the field: current behaviour, never a guess.
  assert.equal(showsLanguageNotice(undefined, "ja"), false);
});
