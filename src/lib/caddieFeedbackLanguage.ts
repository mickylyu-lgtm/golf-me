// The language Caddie writes and translates swing feedback in, kept apart
// from the app's own language (LocaleContext, "golfme:locale" + the
// account's profiles.language). Micky, 2026-11-05 (review option B): the
// picker on the Caddie screen sets this only; it used to call setLocale and
// switch the whole app.
//
// - Until the golfer picks one, it follows the app language (whatever that
//   is at the moment), so nothing changes for anyone who never touches it.
// - An explicit pick is kept on this device (localStorage). There is no
//   profile column for it; storing it per account would need a migration.
// - Never reads or writes the app locale's storage key.
//
// No React imports, so tests/caddieFeedbackLanguage.test.ts runs under node;
// the hook is lib/useCaddieFeedbackLanguage.ts.
import type { CaddieAnalysisLanguage } from "../types";

export const CADDIE_FEEDBACK_LANGUAGE_KEY = "golfme:caddieFeedbackLanguage";

const LANGUAGES: readonly string[] = ["en", "zh-CN", "zh-TW", "es", "ko", "ja"] satisfies readonly CaddieAnalysisLanguage[];

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Kept in memory too, so a pick still holds for this page when storage is blocked.
let memory: CaddieAnalysisLanguage | null = null;
const listeners = new Set<() => void>();

// The explicit pick, or null when the golfer never chose one.
export function storedCaddieFeedbackLanguage(): CaddieAnalysisLanguage | null {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(CADDIE_FEEDBACK_LANGUAGE_KEY);
    return raw !== null && LANGUAGES.includes(raw) ? (raw as CaddieAnalysisLanguage) : null;
  } catch {
    // Storage blocked: fall back to this page's pick, if any.
    return memory;
  }
}

// The language to ask Caddie for: the pick, else the app's language.
export function caddieFeedbackLanguage(appLocale: string): string {
  return storedCaddieFeedbackLanguage() ?? appLocale;
}

export function setCaddieFeedbackLanguage(language: string): void {
  if (!LANGUAGES.includes(language)) return;
  memory = language as CaddieAnalysisLanguage;
  try {
    storage()?.setItem(CADDIE_FEEDBACK_LANGUAGE_KEY, language);
  } catch {
    // Storage blocked: the pick still counts for this page's lifetime.
  }
  for (const listener of listeners) listener();
}

export function subscribeCaddieFeedbackLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
