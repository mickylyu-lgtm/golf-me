// Reads analyze-swing's failure code back out of caddie_analyses.error_message
// (format written by supabase/functions/_shared/caddieReliability.ts:
// `code:<code> [window:<start>-<end>] <detail>`). Rows from before codes
// existed hold free text only and map to "unknown", which keeps the old
// generic copy. The detail text is diagnostic and never shown.
import type { TranslationKey } from "../i18n/locales/en";

export type CaddieFailureCode = "pose_not_found" | "provider_busy" | "timeout" | "upload" | "unknown";

const KNOWN_CODES = new Set<CaddieFailureCode>(["pose_not_found", "provider_busy", "timeout", "upload", "unknown"]);

export interface ParsedCaddieFailure {
  code: CaddieFailureCode;
  // The trim window that attempt analyzed, if the golfer picked one.
  window?: { startSeconds: number; endSeconds: number };
}

export function parseCaddieFailure(errorMessage: string | null | undefined): ParsedCaddieFailure {
  if (!errorMessage) return { code: "unknown" };
  const codeMatch = /^code:([a-z_]+)(?:\s|$)/.exec(errorMessage);
  const raw = codeMatch?.[1] as CaddieFailureCode | undefined;
  const code: CaddieFailureCode = raw && KNOWN_CODES.has(raw) ? raw : "unknown";
  const windowMatch = codeMatch ? /^code:[a-z_]+ window:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?:\s|$)/.exec(errorMessage) : null;
  if (windowMatch) {
    const startSeconds = Number(windowMatch[1]);
    const endSeconds = Number(windowMatch[2]);
    if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds) {
      return { code, window: { startSeconds, endSeconds } };
    }
  }
  return { code };
}

// Short label for the history list row.
export const FAILURE_SHORT_KEYS: Record<CaddieFailureCode, TranslationKey> = {
  pose_not_found: "caddie.failure.poseNotFound.short",
  provider_busy: "caddie.failure.providerBusy.short",
  timeout: "caddie.failure.timeout.short",
  upload: "caddie.failure.upload.short",
  unknown: "caddie.askCaddieError",
};

// Title + guidance on the analysis detail page.
export const FAILURE_TITLE_KEYS: Record<CaddieFailureCode, TranslationKey> = {
  pose_not_found: "caddie.failure.poseNotFound.title",
  provider_busy: "caddie.failure.providerBusy.title",
  timeout: "caddie.failure.timeout.title",
  upload: "caddie.failure.upload.title",
  unknown: "caddie.askCaddieError",
};

export const FAILURE_BODY_KEYS: Record<CaddieFailureCode, TranslationKey | undefined> = {
  pose_not_found: "caddie.failure.poseNotFound.body",
  provider_busy: "caddie.failure.providerBusy.body",
  timeout: "caddie.failure.timeout.body",
  upload: "caddie.failure.upload.body",
  unknown: undefined,
};
