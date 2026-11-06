// Run: npm run test:caddie  (node --test, built-in type stripping)
// Caddie failure taxonomy, step-retry policy and allowance constants
// (supabase/functions/_shared/caddieReliability.ts), the app's reading of
// them (src/lib/caddieFailure.ts, src/lib/caddieAnalysis.ts), and drift
// against migration 20261107140000 (its CHECK lists and trigger constants).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CADDIE_FAILURE_CATEGORIES,
  CADDIE_STAGES,
  DAILY_LIMIT_PER_USER,
  MAX_ATTEMPTS,
  PIPELINE_START_CEILING,
  classifyGeminiFileState,
  classifyHttpFailure,
  classifyThrown,
  formatStructuredFailure,
  legacyCodeFor,
  maxStepAttempts,
  providerErrorHint,
  stepRetryDelayMs,
} from "../supabase/functions/_shared/caddieReliability.ts";
import { FAILURE_KIND_KEYS, REQUEST_ERROR_CODES, analysisFailure, parseCaddieFailure, requestErrorKey } from "../src/lib/caddieFailure.ts";
import { isStaleProcessing } from "../src/lib/caddieAnalysis.ts";
import { caddieErrorText } from "../src/lib/caddieErrorText.ts";
import { makeTranslator } from "../src/i18n/translate.ts";
import { en } from "../src/i18n/locales/en.ts";
import { es } from "../src/i18n/locales/es.ts";
import { ja } from "../src/i18n/locales/ja.ts";
import { ko } from "../src/i18n/locales/ko.ts";
import { zhCN } from "../src/i18n/locales/zh-CN.ts";
import { zhTW } from "../src/i18n/locales/zh-TW.ts";

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261107140000_caddie_failure_taxonomy_and_allowance.sql", import.meta.url), "utf8");

function quotedListAfter(marker: string): string[] {
  const start = MIGRATION.indexOf(marker);
  assert.ok(start >= 0, `marker ${marker} not found in migration`);
  const end = MIGRATION.indexOf(")\n  )", start);
  return [...MIGRATION.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("stage and category lists match the migration's CHECK constraints", () => {
  assert.deepEqual(quotedListAfter("caddie_analyses_stage_valid"), [...CADDIE_STAGES]);
  assert.deepEqual(quotedListAfter("caddie_analyses_failure_stage_valid"), [...CADDIE_STAGES]);
  assert.deepEqual(quotedListAfter("caddie_analyses_failure_category_valid"), [...CADDIE_FAILURE_CATEGORIES]);
});

test("allowance, ceiling and attempt cap match the migration's triggers", () => {
  assert.match(MIGRATION, new RegExp(`v_limit constant integer := ${DAILY_LIMIT_PER_USER};`));
  assert.match(MIGRATION, new RegExp(`v_ceiling constant integer := ${PIPELINE_START_CEILING};`));
  assert.match(MIGRATION, new RegExp(`v_max_attempts constant smallint := ${MAX_ATTEMPTS};`));
  assert.match(MIGRATION, new RegExp(`attempt between 1 and ${MAX_ATTEMPTS}`));
  assert.equal(DAILY_LIMIT_PER_USER, 30);
  assert.equal(PIPELINE_START_CEILING, 60);
  assert.equal(MAX_ATTEMPTS, 4); // 1 run + 3 Try agains
});

test("only transient HTTP failures are retryable", () => {
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429), { category: "provider_rate_limited", retryable: true });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 503), { category: "provider_unavailable", retryable: true });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 408), { category: "provider_unavailable", retryable: true });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 401), { category: "provider_config", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 404), { category: "provider_config", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 400), { category: "internal", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_upload", 400), { category: "video_unreadable", retryable: false });
});

test("credit/quota exhaustion is its own category and is not retried as a 4xx", () => {
  assert.deepEqual(classifyHttpFailure("pose", 403, "quota_or_credit"), { category: "provider_quota_exhausted", retryable: false });
  assert.deepEqual(classifyHttpFailure("pose", 402, "quota_or_credit"), { category: "provider_quota_exhausted", retryable: false });
  // Depleted credits / daily quota: never auto-retried.
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, "RESOURCE_EXHAUSTED,quota_or_credit"), { category: "provider_quota_exhausted", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_upload", 403, "PERMISSION_DENIED,quota_or_credit"), { category: "provider_quota_exhausted", retryable: false });
  // A per-minute limit says "quota" too, but passes: bounded retries.
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, "RESOURCE_EXHAUSTED,quota_or_credit,per_minute"), { category: "provider_rate_limited", retryable: true });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, ""), { category: "provider_rate_limited", retryable: true });
});

test("Gemini's real error bodies: depleted credits vs. a per-minute limit", () => {
  const credits = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing." },
  });
  const daily = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_requests_per_day." },
  });
  const perMinute = JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel",
    },
  });
  const billing403 = JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Billing is not enabled for this project." } });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, providerErrorHint(credits)), { category: "provider_quota_exhausted", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, providerErrorHint(daily)), { category: "provider_quota_exhausted", retryable: false });
  assert.deepEqual(classifyHttpFailure("gemini_generate", 429, providerErrorHint(perMinute)), { category: "provider_rate_limited", retryable: true });
  assert.deepEqual(classifyHttpFailure("gemini_upload", 403, providerErrorHint(billing403)), { category: "provider_quota_exhausted", retryable: false });
  // Shown as "Caddie is temporarily unavailable" + "didn't use an analysis".
  assert.equal(analysisFailure("code:provider_busy x", false, "provider_quota_exhausted", 1).kind, "providerDown");
  assert.equal(stepRetryDelayMs({ category: "provider_quota_exhausted", retryable: false }, 1, 300_000, 0), null);
});

test("extract-frames / trim-video tokens map to video vs. infrastructure failures", () => {
  for (const stage of ["frame_extract", "trim"] as const) {
    assert.deepEqual(classifyHttpFailure(stage, 422, "decode_failed"), { category: "video_unreadable", retryable: false });
    assert.deepEqual(classifyHttpFailure(stage, 422, "no_video_stream"), { category: "video_unreadable", retryable: false });
    assert.deepEqual(classifyHttpFailure(stage, 500, "resources_exhausted"), { category: "video_too_long_or_large", retryable: false });
    assert.deepEqual(classifyHttpFailure(stage, 500, "internal"), { category: "provider_unavailable", retryable: true });
    assert.deepEqual(classifyHttpFailure(stage, 502, "source_fetch_failed"), { category: "provider_unavailable", retryable: true });
    // A heavy ffmpeg run that timed out would time out again.
    assert.deepEqual(classifyHttpFailure(stage, 504, ""), { category: "provider_unavailable", retryable: false });
    // A bare 500 is an older route build: its 500 meant "couldn't read it".
    assert.deepEqual(classifyHttpFailure(stage, 500, ""), { category: "video_unreadable", retryable: false });
    assert.deepEqual(classifyHttpFailure(stage, 413, ""), { category: "video_too_long_or_large", retryable: false });
  }
  assert.deepEqual(classifyHttpFailure("media_fetch", 404), { category: "video_unreadable", retryable: false });
});

test("thrown errors are classified by class name only", () => {
  const timeout = new Error("signal timed out https://x/?key=AIza");
  timeout.name = "TimeoutError";
  assert.deepEqual(classifyThrown("gemini_generate", timeout), { category: "provider_unavailable", retryable: true });
  assert.deepEqual(classifyThrown("trim", timeout), { category: "provider_unavailable", retryable: false });
  assert.deepEqual(classifyThrown("pose", new TypeError("network")), { category: "provider_unavailable", retryable: true });
  assert.deepEqual(classifyThrown("gemini_generate", new SyntaxError("bad json")), { category: "model_output_invalid", retryable: true });
  assert.deepEqual(classifyThrown("save", new Error("?")), { category: "internal", retryable: false });
});

test("Gemini file states: FAILED is an unreadable video, not 'busy'", () => {
  assert.equal(classifyGeminiFileState("ACTIVE"), null);
  assert.deepEqual(classifyGeminiFileState("FAILED"), { category: "video_unreadable", retryable: false });
  assert.deepEqual(classifyGeminiFileState("PROCESSING"), { category: "provider_unavailable", retryable: true });
  assert.deepEqual(classifyGeminiFileState(undefined), { category: "provider_unavailable", retryable: true });
});

test("step retry: at most 2 more tries, back-off grows, never past the deadline", () => {
  const transient = { category: "provider_unavailable" as const, retryable: true };
  const fixed = () => 0;
  assert.equal(stepRetryDelayMs(transient, 1, 300_000, 30_000, null, fixed), 2000);
  assert.equal(stepRetryDelayMs(transient, 2, 300_000, 30_000, null, fixed), 6000);
  assert.equal(stepRetryDelayMs(transient, 3, 300_000, 30_000, null, fixed), null); // 3 tries total
  assert.equal(maxStepAttempts("provider_unavailable"), 3);
  // Retry-After is honored, capped at 10 s.
  assert.equal(stepRetryDelayMs(transient, 1, 300_000, 30_000, "4", fixed), 4000);
  assert.equal(stepRetryDelayMs(transient, 1, 300_000, 30_000, "120", fixed), 10_000);
  // Not enough deadline left for the wait plus one more run of the step.
  assert.equal(stepRetryDelayMs(transient, 1, 31_000, 30_000, null, fixed), null);
  // Non-retryable never retries; bad model output gets exactly one more try.
  assert.equal(stepRetryDelayMs({ category: "video_unreadable", retryable: false }, 1, 300_000, 0, null, fixed), null);
  assert.equal(stepRetryDelayMs({ category: "model_output_invalid", retryable: true }, 1, 300_000, 0, null, fixed), 2000);
  assert.equal(stepRetryDelayMs({ category: "model_output_invalid", retryable: true }, 2, 300_000, 0, null, fixed), null);
});

test("structured error_message keeps the legacy code (+ window) and no free text", () => {
  const msg = formatStructuredFailure(
    { stage: "gemini_processing", category: "video_unreadable", retryable: false, detail: "file state FAILED https://x?key=AIzaSECRETSECRETSECRET" },
    { startSeconds: 2, endSeconds: 9.5 },
  );
  assert.equal(msg, "code:upload window:2.000-9.500 video_unreadable@gemini_processing");
  assert.deepEqual(parseCaddieFailure(msg), { code: "upload", window: { startSeconds: 2, endSeconds: 9.5 } });
  for (const category of CADDIE_FAILURE_CATEGORIES) assert.ok(legacyCodeFor(category));
  assert.equal(legacyCodeFor("worker_lost"), "timeout");
  assert.equal(legacyCodeFor("provider_quota_exhausted"), "provider_busy");
});

test("the app prefers failure_category, falls back to the legacy code, and caps retries", () => {
  assert.equal(analysisFailure("code:provider_busy x", false, "provider_quota_exhausted", 1).kind, "providerDown");
  assert.equal(analysisFailure("code:upload x", false, "video_too_long_or_large", 1).kind, "videoTooLarge");
  assert.equal(analysisFailure("code:pose_not_found x", false, null, null).kind, "poseNotFound");
  assert.equal(analysisFailure("legacy text", false).kind, "unknown");
  assert.equal(analysisFailure(null, true).kind, "timeout");
  assert.equal(analysisFailure("code:timeout x", false, "not_a_category", 1).kind, "timeout");
  assert.equal(analysisFailure(null, false, "internal", 3).canRetry, true);
  assert.equal(analysisFailure(null, false, "internal", 4).canRetry, false);
  for (const category of CADDIE_FAILURE_CATEGORIES) {
    const kind = analysisFailure(null, false, category, 1).kind;
    assert.ok(FAILURE_KIND_KEYS[kind], category);
  }
});

test("stale detection uses the current attempt's start, not created_at", () => {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  assert.equal(isStaleProcessing({ status: "processing", createdAt: hourAgo, attemptStartedAt: now }), false);
  assert.equal(isStaleProcessing({ status: "processing", createdAt: hourAgo }), true);
  assert.equal(isStaleProcessing({ status: "failed", createdAt: hourAgo }), false);
});

const LOCALES = { en, es, ja, ko, "zh-CN": zhCN, "zh-TW": zhTW } as Record<string, Record<string, string>>;

test("every failure / refusal message exists, non-empty, in all 6 locales", () => {
  const keys = new Set<string>(["caddie.failure.noCharge"]);
  for (const k of Object.values(FAILURE_KIND_KEYS)) {
    keys.add(k.short);
    keys.add(k.title);
    if (k.body) keys.add(k.body);
  }
  for (const code of REQUEST_ERROR_CODES) keys.add(requestErrorKey(code)!);
  for (const [name, dict] of Object.entries(LOCALES)) {
    for (const key of keys) assert.ok(typeof dict[key] === "string" && dict[key].trim().length > 0, `${name}: ${key}`);
    assert.match(dict["caddie.error.dailyLimit"], /\{limit\}/, `${name}: dailyLimit placeholder`);
  }
});

test("every analyze-swing refusal code has localized copy", () => {
  for (const code of ["daily_limit", "attempt_ceiling", "retry_cap", "cooldown", "already_running", "not_authenticated", "forbidden", "cant_analyze", "bad_request", "not_found", "unavailable", "provider_busy", "network", "upload_failed"]) {
    assert.ok(requestErrorKey(code), code);
  }
  assert.equal(requestErrorKey(undefined), undefined);
  assert.equal(requestErrorKey("something_new"), undefined);
});

test("a coded refusal reaches the golfer in the Caddie language, never the server's English", () => {
  const tZh = makeTranslator<keyof typeof en>(zhCN, en);
  for (const code of REQUEST_ERROR_CODES) {
    const err = Object.assign(new Error("Some English server sentence."), { code });
    const text = caddieErrorText(err, tZh);
    assert.equal(text, tZh(requestErrorKey(code)!, { limit: DAILY_LIMIT_PER_USER }), code);
    assert.doesNotMatch(text, /[A-Za-z]{4,}/, `${code}: "${text}"`);
  }
  assert.match(caddieErrorText(Object.assign(new Error("x"), { code: "daily_limit" }), tZh), /30/);
});
