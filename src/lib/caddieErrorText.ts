// What a Caddie screen shows for a failed request, always in the screen's
// own language (Micky, 2026-11-05: "all parts within Caddie should be fully
// translated"). analyze-swing and translate-caddie-analysis answer with
// English sentences and, mostly, no code; the client used to toast them
// verbatim. They're stable strings written for this, so they map to keys
// here. Anything unrecognised (a network error, a storage error, a message
// from a newer server) falls back to a translated generic line, never raw
// English. The real fix is a `code` on every server error (see
// DEVELOPMENT_STATUS.md); a coded refusal is already read by code first.
// No React imports, so tests/caddieErrorText.test.ts runs under node.
import type { TranslationKey } from "../i18n/locales/en";
import { FAILURE_BODY_KEYS, parseCaddieFailure } from "./caddieFailure.ts";

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Exact server (and client-thrown) messages -> keys. Messages that only
// mean "the request was malformed" map to the generic line.
const MESSAGE_KEYS: Record<string, TranslationKey> = {
  // analyze-swing
  "Caddie is busy right now. Please try again in a minute.": "caddie.failure.providerBusy.body",
  "Caddie isn't configured yet. Please try again later.": "caddie.error.unavailable",
  "Caddie is temporarily unavailable. Please try again.": "caddie.error.unavailable",
  "Not authenticated.": "caddie.error.signedOut",
  "Not signed in.": "caddie.error.signedOut",
  "Source post not found.": "caddie.error.postNotFound",
  "Ask Caddie is only available on your own posts.": "caddie.error.ownPostsOnly",
  "This swing video can't be analyzed.": "caddie.error.videoUnusable",
  "Please wait a moment before asking Caddie again.": "caddie.error.tooSoon",
  // translate-caddie-analysis
  "Translation isn't configured yet. Please try again later.": "caddie.error.translateFailed",
  "Analysis not found.": "caddie.error.analysisNotFound",
  "This analysis isn't ready to translate yet.": "caddie.error.translateNotReady",
  "Please wait a moment before translating again.": "caddie.error.translateTooSoon",
  "Caddie couldn't translate this analysis. Please try again.": "caddie.error.translateFailed",
  "Translated, but saving it failed. Please try again.": "caddie.error.translateFailed",
  // lib/caddieMedia.ts
  "Can only share your own swing.": "caddie.error.ownPostsOnly",
};

// analyze-swing's pre-check and the caddie_analyses daily-limit trigger.
const DAILY_LIMIT = /^You've reached today's Caddie analysis limit \((\d+)\)\. Try again tomorrow\.$/;

export function caddieErrorText(err: unknown, t: T, fallback: TranslationKey = "caddie.askCaddieError"): string {
  if (typeof err !== "object" || err === null) return t(fallback);
  const { code, message, name } = err as { code?: unknown; message?: unknown; name?: unknown };
  if (typeof code === "string" && code) {
    const bodyKey = FAILURE_BODY_KEYS[parseCaddieFailure(`code:${code}`).code];
    if (bodyKey) return t(bodyKey);
  }
  if (typeof message === "string") {
    const text = message.trim();
    const key = MESSAGE_KEYS[text];
    if (key) return t(key);
    const limit = DAILY_LIMIT.exec(text);
    if (limit) return t("caddie.error.dailyLimit", { limit: Number(limit[1]) });
  }
  // Supabase Storage upload failures (the swing video or its thumbnail).
  if (name === "StorageError" || name === "StorageApiError" || name === "StorageUnknownError") return t("caddie.failure.upload.body");
  return t(fallback);
}
