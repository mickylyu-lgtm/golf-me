// Coordination for Caddie's automatic feedback translation (see
// needsAutoTranslate in caddieLanguage.ts), shared by the analysis page and
// the Caddie screen's language picker. No React imports, so
// tests/caddieAutoTranslate.test.ts runs under plain node.
//
// - One translation at a time per analysis: a second request (another
//   language, or the other screen asking for the same one) waits for the
//   running one instead of racing it into the server's cooldown and being
//   dropped (Micky, 2026-11-04: switching quickly "misses the translation
//   window").
// - Choosing a language in Caddie's own picker is an explicit "show my
//   Caddie feedback in this language" (Micky: "make the button send a
//   stronger signal"): for the rest of the session it also covers older
//   analyses whose language can't be told apart by script (English vs
//   Spanish, Simplified vs Traditional Chinese).

const running = new Map<string, Promise<void>>();

// Runs `job` after any translation already running for this analysis, so
// jobs for one analysis never overlap. Resolves/rejects with the job.
export function queueTranslation(analysisId: string, job: () => Promise<void>): Promise<void> {
  const previous = running.get(analysisId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(job);
  running.set(analysisId, next);
  const clear = () => {
    if (running.get(analysisId) === next) running.delete(analysisId);
  };
  next.then(clear, clear);
  return next;
}

// One automatic translation as a queued job: skipped when the app has moved
// to another language before its turn (the last pick wins), otherwise
// translated. Resolves "translated" or "skipped"; rejects with the
// translation's own error.
export function queueAutoTranslation(
  analysisId: string,
  target: string,
  currentLocale: () => string,
  translate: (analysisId: string, locale: string) => Promise<void>,
): Promise<"translated" | "skipped"> {
  let outcome: "translated" | "skipped" = "skipped";
  return queueTranslation(analysisId, async () => {
    if (currentLocale() !== target) return;
    await translate(analysisId, target);
    outcome = "translated";
  }).then(() => outcome);
}

export function isTranslationRunning(analysisId: string): boolean {
  return running.has(analysisId);
}

// Settles (never rejects) once nothing is running for this analysis.
export function whenTranslationSettled(analysisId: string): Promise<void> {
  const current = running.get(analysisId);
  return current ? current.then(
    () => undefined,
    () => undefined,
  ) : Promise.resolve();
}

const EXPLICIT_KEY = "golfme.caddie.explicitLocale";
let explicitLocale: string | null = null;

export function markExplicitCaddieLocale(locale: string): void {
  explicitLocale = locale;
  try {
    window.sessionStorage.setItem(EXPLICIT_KEY, locale);
  } catch {
    // Storage blocked: the choice still counts for this page's lifetime.
  }
}

export function isExplicitCaddieLocale(locale: string): boolean {
  if (explicitLocale === null) {
    try {
      explicitLocale = typeof window === "undefined" ? null : window.sessionStorage.getItem(EXPLICIT_KEY);
    } catch {
      explicitLocale = null;
    }
  }
  return explicitLocale === locale;
}

// How long the picker waits after the last change before translating, so
// flicking through languages doesn't translate into each one.
export const PICKER_TRANSLATE_DELAY_MS = 1500;
// The newest analyses the picker pre-translates (one AI call each).
export const PICKER_TRANSLATE_COUNT = 3;
