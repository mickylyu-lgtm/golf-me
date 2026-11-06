// Reads analyze-swing's failure back out of a caddie_analyses row.
//
// Rows from 2026-11-06 on carry a structured failure_category (migration
// 20261107140000, written by analyze-swing / sweep_stale_caddie_jobs) — that
// wins. Older rows only have the error_message format written by
// supabase/functions/_shared/caddieReliability.ts
// (`code:<code> [window:<start>-<end>] <detail>`); rows from before codes
// existed hold free text only and map to "unknown", which keeps the old
// generic copy. The detail text is diagnostic and never shown.
import type { TranslationKey } from "../i18n/locales/en";
import { CADDIE_FAILURE_CATEGORIES, MAX_ATTEMPTS } from "../../supabase/functions/_shared/caddieReliability.ts";
import type { CaddieFailureCategory } from "../../supabase/functions/_shared/caddieReliability.ts";

export type { CaddieFailureCategory };
export type CaddieFailureCode = "pose_not_found" | "provider_busy" | "timeout" | "upload" | "unknown";

const KNOWN_CODES = new Set<CaddieFailureCode>(["pose_not_found", "provider_busy", "timeout", "upload", "unknown"]);
const KNOWN_CATEGORIES = new Set<string>(CADDIE_FAILURE_CATEGORIES);

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

// Short label for the history list row (legacy, by code).
export const FAILURE_SHORT_KEYS: Record<CaddieFailureCode, TranslationKey> = {
  pose_not_found: "caddie.failure.poseNotFound.short",
  provider_busy: "caddie.failure.providerBusy.short",
  timeout: "caddie.failure.timeout.short",
  upload: "caddie.failure.upload.short",
  unknown: "caddie.askCaddieError",
};

// Title + guidance on the analysis detail page (legacy, by code).
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

// ---- What the golfer is told, per failure kind ----
export type CaddieFailureKind =
  | "poseNotFound"
  | "providerBusy"
  | "providerDown"
  | "timeout"
  | "upload"
  | "videoTooLarge"
  | "couldNotFinish"
  | "unknown";

const KIND_FOR_CATEGORY: Record<CaddieFailureCategory, CaddieFailureKind> = {
  video_unreadable: "upload",
  video_too_long_or_large: "videoTooLarge",
  pose_not_found: "poseNotFound",
  provider_rate_limited: "providerBusy",
  provider_unavailable: "providerBusy",
  provider_quota_exhausted: "providerDown",
  provider_config: "providerDown",
  model_output_invalid: "couldNotFinish",
  deadline_exceeded: "timeout",
  worker_lost: "timeout",
  save_failed: "couldNotFinish",
  internal: "couldNotFinish",
};

const KIND_FOR_CODE: Record<CaddieFailureCode, CaddieFailureKind> = {
  pose_not_found: "poseNotFound",
  provider_busy: "providerBusy",
  timeout: "timeout",
  upload: "upload",
  unknown: "unknown",
};

export const FAILURE_KIND_KEYS: Record<CaddieFailureKind, { short: TranslationKey; title: TranslationKey; body?: TranslationKey }> = {
  poseNotFound: { short: "caddie.failure.poseNotFound.short", title: "caddie.failure.poseNotFound.title", body: "caddie.failure.poseNotFound.body" },
  providerBusy: { short: "caddie.failure.providerBusy.short", title: "caddie.failure.providerBusy.title", body: "caddie.failure.providerBusy.body" },
  providerDown: { short: "caddie.failure.providerDown.short", title: "caddie.failure.providerDown.title", body: "caddie.failure.providerDown.body" },
  timeout: { short: "caddie.failure.timeout.short", title: "caddie.failure.timeout.title", body: "caddie.failure.timeout.body" },
  upload: { short: "caddie.failure.upload.short", title: "caddie.failure.upload.title", body: "caddie.failure.upload.body" },
  videoTooLarge: { short: "caddie.failure.videoTooLarge.short", title: "caddie.failure.videoTooLarge.title", body: "caddie.failure.videoTooLarge.body" },
  couldNotFinish: { short: "caddie.failure.couldNotFinish.short", title: "caddie.failure.couldNotFinish.title", body: "caddie.failure.couldNotFinish.body" },
  unknown: { short: "caddie.askCaddieError", title: "caddie.askCaddieError" },
};

export interface AnalysisFailure extends ParsedCaddieFailure {
  kind: CaddieFailureKind;
  category?: CaddieFailureCategory;
  // False once the job has used all its tries (1 run + 3 Try agains): the
  // golfer is asked to film a new clip instead.
  canRetry: boolean;
}

// A 'processing' row past the client's stale threshold (isStaleProcessing)
// was killed before it could write anything: show it as a timeout.
export function analysisFailure(
  errorMessage: string | null | undefined,
  staleProcessing: boolean,
  failureCategory?: string | null,
  attempt?: number | null,
): AnalysisFailure {
  const parsed = parseCaddieFailure(errorMessage);
  const canRetry = (attempt ?? 1) < MAX_ATTEMPTS;
  if (staleProcessing) return { code: "timeout", kind: "timeout", category: "worker_lost", canRetry, ...(parsed.window ? { window: parsed.window } : {}) };
  if (failureCategory && KNOWN_CATEGORIES.has(failureCategory)) {
    const category = failureCategory as CaddieFailureCategory;
    return { ...parsed, kind: KIND_FOR_CATEGORY[category], category, canRetry };
  }
  return { ...parsed, kind: KIND_FOR_CODE[parsed.code], canRetry };
}

// ---- analyze-swing refusals (no analysis was created or re-run) ----
// The function answers every refusal with a stable `code`; the app shows
// localized copy for it instead of the server's English sentence.
// Rendered through caddieErrorText() in the Caddie language; reuses the
// keys src/lib/caddieErrorText.ts already maps the server's English to.
const REQUEST_ERROR_KEYS: Record<string, TranslationKey> = {
  daily_limit: "caddie.error.dailyLimit",
  attempt_ceiling: "caddie.error.attemptCeiling",
  retry_cap: "caddie.error.retryCap",
  cooldown: "caddie.error.tooSoon",
  already_running: "caddie.error.alreadyRunning",
  not_authenticated: "caddie.error.signedOut",
  forbidden: "caddie.error.ownPostsOnly",
  cant_analyze: "caddie.error.videoUnusable",
  bad_request: "caddie.error.videoUnusable",
  not_found: "caddie.error.analysisNotFound",
  unavailable: "caddie.error.unavailable",
  provider_busy: "caddie.failure.providerBusy.body",
  network: "caddie.error.network",
  upload_failed: "caddie.error.uploadFailed",
  // delete_caddie_analysis()
  delete_running: "caddie.error.deleteRunning",
  forbidden_delete: "caddie.delete.failed",
};

export function requestErrorKey(code: string | undefined): TranslationKey | undefined {
  return code ? REQUEST_ERROR_KEYS[code] : undefined;
}

export const REQUEST_ERROR_CODES = Object.keys(REQUEST_ERROR_KEYS);
