// Run: npm run test:caddie  (node --test, built-in type stripping)
// analysis_json.language and the "this feedback is in X" notice
// (src/lib/caddieLanguage.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisLanguageFromJson, claimAutoTranslateAttempt, needsAutoTranslate, showsLanguageNotice } from "../src/lib/caddieLanguage.ts";

const EN = "Your hips slide toward the target at impact. Turn them instead.";
const ZH = "你的髋部在击球时向目标方向滑动。请改为转动。";
const JA = "インパクトで腰がターゲット方向に流れています。";
const KO = "임팩트 때 골반이 목표 방향으로 밀립니다.";
const ES = "Tus caderas se deslizan hacia el objetivo en el impacto.";

test("auto-translate: a recorded language decides", () => {
  assert.equal(needsAutoTranslate({ language: "en", sampleText: EN }, "zh-CN"), true);
  assert.equal(needsAutoTranslate({ language: "zh-CN", sampleText: ZH }, "zh-CN"), false);
  assert.equal(needsAutoTranslate({ language: "zh-TW", sampleText: ZH }, "zh-CN"), true);
  assert.equal(needsAutoTranslate({ language: "es", sampleText: ES }, "en"), true);
});

test("auto-translate: old rows only when the writing system rules the app's language out", () => {
  const old = (sampleText: string, locale: string) => needsAutoTranslate({ sampleText }, locale);
  // Micky's case: English feedback, Chinese app.
  assert.equal(old(EN, "zh-CN"), true);
  assert.equal(old(EN, "zh-TW"), true);
  assert.equal(old(EN, "ja"), true);
  assert.equal(old(EN, "ko"), true);
  assert.equal(old(ZH, "en"), true);
  assert.equal(old(JA, "es"), true);
  assert.equal(old(KO, "zh-CN"), true);
  assert.equal(old(JA, "zh-CN"), true, "kana is not Chinese");
  assert.equal(old(ZH, "ko"), true);
  // Same script: never guessed.
  assert.equal(old(ES, "en"), false);
  assert.equal(old(EN, "es"), false);
  assert.equal(old(ZH, "zh-TW"), false);
  assert.equal(old(ZH, "ja"), false, "Han-only text could be Japanese");
  // Already right, or nothing to judge.
  assert.equal(old(ZH, "zh-CN"), false);
  assert.equal(old(KO, "ko"), false);
  assert.equal(old(JA, "ja"), false);
  assert.equal(old(EN, "en"), false);
  assert.equal(old("", "zh-CN"), false);
  assert.equal(old("OK 12/20", "zh-CN"), false, "a number or two-letter word isn't enough");
  assert.equal(old(EN, "fr"), false, "not an app locale");
});

test("auto-translate is attempted once per analysis and language per session", () => {
  assert.equal(claimAutoTranslateAttempt("a1", "zh-CN"), true);
  assert.equal(claimAutoTranslateAttempt("a1", "zh-CN"), false);
  assert.equal(claimAutoTranslateAttempt("a1", "ja"), true);
  assert.equal(claimAutoTranslateAttempt("a2", "zh-CN"), true);
});

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
