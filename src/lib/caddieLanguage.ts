import type { CaddieAnalysisLanguage } from "../types";

// Caddie's free text stays in the language the analysis was written in,
// while the app's own labels follow the current locale; nothing translates
// until the golfer taps Translate (translate-caddie-analysis). analyze-swing
// records that language as analysis_json.language so the detail page can
// say so. Rows from before the field have none, and we never guess one.

const ANALYSIS_LANGUAGES: readonly CaddieAnalysisLanguage[] = ["en", "zh-CN", "zh-TW", "es", "ko", "ja"];

export function analysisLanguageFromJson(raw: unknown): CaddieAnalysisLanguage | undefined {
  return typeof raw === "string" && (ANALYSIS_LANGUAGES as readonly string[]).includes(raw) ? (raw as CaddieAnalysisLanguage) : undefined;
}

// Show the "this feedback is in X" notice only when the stored language is
// known and differs from the app's current locale.
export function showsLanguageNotice(analysisLanguage: CaddieAnalysisLanguage | undefined, currentLocale: string): boolean {
  return analysisLanguage !== undefined && analysisLanguage !== currentLocale;
}

// What the analysis page offers for the feedback's language, given the
// Caddie feedback language (`target`):
// - "none": the feedback is recorded as already in it, so no Translate
//   button (Micky, 2026-11-05: "Translate to 简体中文" showed on feedback
//   that was already in Chinese). There is no "Show original": a
//   translation replaces the stored text (translate-caddie-analysis).
// - "notice": recorded in another language: "This feedback is in X" plus
//   Translate (or the automatic translation's progress).
// - "button": an older row with no recorded language: we never guess, so
//   just the Translate button.
export type TranslateOffer = "none" | "notice" | "button";

export function translateOffer(analysisLanguage: CaddieAnalysisLanguage | undefined, target: string): TranslateOffer {
  if (analysisLanguage === undefined) return "button";
  return analysisLanguage === target ? "none" : "notice";
}

// ── Automatic translation (Micky, 2026-11-03: "why do i need to manually
// click translate") ─────────────────────────────────────────────────────
// The detail page translates the feedback by itself when it is clearly not
// in the app's language. Clearly means: the recorded language differs, or,
// for older rows without one, the text's WRITING SYSTEM can't be the app's
// (Latin-only text in the Chinese/Japanese/Korean app; Chinese, Japanese or
// Korean script in the English/Spanish app). Languages sharing a script
// (English vs Spanish, Simplified vs Traditional Chinese) are never guessed
// for an old row: those keep the Translate button.

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN_WORD = /\p{Script=Latin}{3,}/u;

function scriptRulesOut(text: string, locale: string): boolean {
  const han = HAN.test(text);
  const kana = KANA.test(text);
  const hangul = HANGUL.test(text);
  const cjk = han || kana || hangul;
  switch (locale) {
    case "en":
    case "es":
      return cjk;
    case "ja":
      return hangul || (!han && !kana && LATIN_WORD.test(text));
    case "ko":
      return !hangul && (cjk || LATIN_WORD.test(text));
    case "zh-CN":
    case "zh-TW":
      return hangul || kana || (!han && LATIN_WORD.test(text));
    default:
      return false;
  }
}

// `explicit`: the golfer chose this language in Caddie's own picker (see
// caddieAutoTranslate.ts), so an older row whose language can't be told
// apart by script is translated too, rather than left to the button.
export function needsAutoTranslate(
  feedback: { language?: CaddieAnalysisLanguage; sampleText: string },
  currentLocale: string,
  explicit = false,
): boolean {
  if (!(ANALYSIS_LANGUAGES as readonly string[]).includes(currentLocale)) return false;
  if (feedback.language !== undefined) return feedback.language !== currentLocale;
  const text = feedback.sampleText.trim();
  if (text.length === 0) return false;
  return explicit || scriptRulesOut(text, currentLocale);
}

// The text an analysis's language is judged by.
export function feedbackSampleText(details: { summary?: string; strengths?: string[]; focus?: { title?: string } } | undefined): string {
  if (!details) return "";
  return [details.summary ?? "", ...(details.strengths ?? []), details.focus?.title ?? ""].join(" ");
}

// One automatic attempt per analysis and language per app session, so a
// failure or switching languages back and forth never loops or burns calls.
const autoAttempts = new Set<string>();
export function claimAutoTranslateAttempt(analysisId: string, locale: string): boolean {
  const key = `${analysisId}:${locale}`;
  if (autoAttempts.has(key)) return false;
  autoAttempts.add(key);
  return true;
}

// Gives an attempt back when it never really ran (the server said "too
// soon"), so the retry isn't refused as already tried.
export function releaseAutoTranslateAttempt(analysisId: string, locale: string): void {
  autoAttempts.delete(`${analysisId}:${locale}`);
}

// Retry delay after a "too soon" answer: just past the server's 5 s
// double-tap cooldown (translate-caddie-analysis COOLDOWN_SECONDS).
export const AUTO_TRANSLATE_RETRY_MS = 5500;

export function isTooSoonError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 429;
}
