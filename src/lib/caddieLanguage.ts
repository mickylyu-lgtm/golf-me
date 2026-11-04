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
