// Pure helpers for analyze-swing's failure handling — no Deno/Supabase
// imports, so node --test can exercise them (tests/caddieReliability.test.ts).
//
// Failure codes: analyze-swing writes `code:<code>` as the first token of
// caddie_analyses.error_message (no schema change — the column already
// exists, owner-only RLS). The client (src/lib/caddieFailure.ts) maps the
// code to specific re-film / try-again copy. Rows written before codes
// existed have free text only and read as "unknown".

export type CaddieFailureCode = "pose_not_found" | "provider_busy" | "timeout" | "upload" | "unknown";

export interface TrimWindow {
  startSeconds: number;
  endSeconds: number;
}

// ---- Failure taxonomy (2026-11-06) ----
// Stored in caddie_analyses.failure_stage / failure_category (enum-checked
// in migration 20261107140000 — tests/caddieTaxonomy.test.ts fails if these
// lists drift from it) and in private.caddie_job_diagnostics. The legacy
// `code:` prefix in error_message is still written (legacyCodeFor) so an
// older app build keeps showing sensible copy.
export const CADDIE_STAGES = [
  "queued",
  "media_fetch",
  "trim",
  "frame_extract",
  "pose",
  "pose_gate",
  "gemini_upload",
  "gemini_processing",
  "gemini_generate",
  "output_validation",
  "save",
] as const;
export type CaddieStage = (typeof CADDIE_STAGES)[number];

export const CADDIE_FAILURE_CATEGORIES = [
  "video_unreadable",
  "video_too_long_or_large",
  "pose_not_found",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_quota_exhausted",
  "provider_config",
  "model_output_invalid",
  "deadline_exceeded",
  "worker_lost",
  "save_failed",
  "internal",
] as const;
export type CaddieFailureCategory = (typeof CADDIE_FAILURE_CATEGORIES)[number];

// Same values as the migration's triggers.
export const DAILY_LIMIT_PER_USER = 30; // delivered analyses per rolling 24 h
export const PIPELINE_START_CEILING = 60; // pipeline runs per rolling 24 h, failures included
export const MAX_ATTEMPTS = 4; // 1 run + 3 Try agains on the same row
export const STALE_PROCESSING_MS = 6 * 60 * 1000; // a 'processing' attempt older than this is abandoned
export const WORKER_LOST_MS = 390 * 1000; // sweep_stale_caddie_jobs() threshold

export interface StepFailure {
  stage: CaddieStage;
  category: CaddieFailureCategory;
  retryable: boolean;
  httpStatus?: number;
  // Already-safe tokens only (status, allow-listed hints, error class names);
  // still passed through redactDetail() before storage.
  detail: string;
}

export function legacyCodeFor(category: CaddieFailureCategory): CaddieFailureCode {
  switch (category) {
    case "pose_not_found":
      return "pose_not_found";
    case "provider_rate_limited":
    case "provider_unavailable":
    case "provider_quota_exhausted":
    case "provider_config":
      return "provider_busy";
    case "deadline_exceeded":
    case "worker_lost":
      return "timeout";
    case "video_unreadable":
    case "video_too_long_or_large":
      return "upload";
    default:
      return "unknown";
  }
}

// Total tries of ONE step (1 call + retries) for a retryable failure.
export function maxStepAttempts(category: CaddieFailureCategory): number {
  return category === "model_output_invalid" ? 2 : 3;
}

const STEP_BACKOFF_BASE_MS = 2000;
const STEP_BACKOFF_CAP_MS = 10_000;

// Delay before re-running a failed step, or null when it must not be
// retried: not retryable, out of tries, or not enough pipeline deadline
// left for the wait plus one more typical run of the step.
export function stepRetryDelayMs(
  failure: Pick<StepFailure, "category" | "retryable">,
  stepAttempt: number,
  remainingMs: number,
  stepBudgetMs: number,
  retryAfterHeader?: string | null,
  random: () => number = Math.random,
): number | null {
  if (!failure.retryable || stepAttempt >= maxStepAttempts(failure.category)) return null;
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const base =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? retryAfterSeconds * 1000
      : STEP_BACKOFF_BASE_MS * 3 ** (stepAttempt - 1) * (1 + 0.25 * random());
  const delay = Math.round(Math.min(STEP_BACKOFF_CAP_MS, base));
  return remainingMs - delay > stepBudgetMs ? delay : null;
}

// HTTP failure of a provider or one of our Vercel routes -> category.
// `hint` is providerErrorHint() of the body (allow-listed tokens only).
export function classifyHttpFailure(stage: CaddieStage, status: number, hint = ""): Pick<StepFailure, "category" | "retryable"> {
  const quota = hint.includes("quota_or_credit");
  const perMinute = hint.includes("per_minute");
  const route = stage === "trim" || stage === "frame_extract";
  // Out of credits / daily quota / billing (e.g. "my Gemini credits ran
  // out"): retrying can't help and only burns time, so it is NOT retried; a
  // per-minute rate limit (or a bare 429) is, with back-off.
  if (status === 429) {
    return quota && !perMinute ? { category: "provider_quota_exhausted", retryable: false } : { category: "provider_rate_limited", retryable: true };
  }
  if (quota && status >= 400 && status < 500) return { category: "provider_quota_exhausted", retryable: false };
  if (route) {
    if (status === 422 || hint.includes("decode_failed") || hint.includes("no_video_stream")) return { category: "video_unreadable", retryable: false };
    if (status === 413 || hint.includes("resources_exhausted")) return { category: "video_too_long_or_large", retryable: false };
    if (status === 502 && hint.includes("source_fetch_failed")) return { category: "provider_unavailable", retryable: true };
    // A heavy ffmpeg run that timed out will time out again.
    if (status === 504) return { category: "provider_unavailable", retryable: false };
    // Our current routes always send a token with a 500; a bare 500 is an
    // older route build, whose 500 meant "ffmpeg couldn't read it".
    if (status === 500) return hint.includes("internal") ? { category: "provider_unavailable", retryable: true } : { category: "video_unreadable", retryable: false };
  }
  if (stage === "media_fetch") {
    if (status === 400 || status === 404) return { category: "video_unreadable", retryable: false };
  }
  if (status === 401 || status === 403) return { category: "provider_config", retryable: false };
  if (status === 404) return { category: "provider_config", retryable: false };
  if (status === 413) return { category: "video_too_long_or_large", retryable: false };
  if (status === 408 || status >= 500) return { category: "provider_unavailable", retryable: true };
  if (status === 400 && (stage === "gemini_upload" || stage === "gemini_processing")) return { category: "video_unreadable", retryable: false };
  return { category: "internal", retryable: false };
}

// A thrown value (fetch/network/timeout/parse) -> category. Uses the class
// name only.
export function classifyThrown(stage: CaddieStage, err: unknown): Pick<StepFailure, "category" | "retryable"> {
  const name = safeErrorName(err);
  const route = stage === "trim" || stage === "frame_extract";
  if (name === "TimeoutError" || name === "AbortError") return { category: "provider_unavailable", retryable: !route };
  if (name === "SyntaxError" && stage === "gemini_generate") return { category: "model_output_invalid", retryable: true };
  if (name === "TypeError") return { category: "provider_unavailable", retryable: true };
  return { category: "internal", retryable: false };
}

// Gemini Files API state after upload. PROCESSING past the wait budget is
// transient; FAILED means Gemini could not decode the video.
export function classifyGeminiFileState(state: string | undefined): Pick<StepFailure, "category" | "retryable"> | null {
  if (state === "ACTIVE") return null;
  if (state === "FAILED") return { category: "video_unreadable", retryable: false };
  return { category: "provider_unavailable", retryable: true };
}

// The value written to caddie_analyses.error_message for a structured
// failure: the legacy code (+ window) for older clients, then
// `<category>@<stage>` — never free text.
export function formatStructuredFailure(failure: StepFailure, window?: TrimWindow): string {
  return formatFailure(legacyCodeFor(failure.category), `${failure.category}@${failure.stage}`, window);
}

const MAX_ERROR_MESSAGE_CHARS = 800;

// `code:<code> [window:<start>-<end>] <detail>`. The window is the golfer-
// picked trim window this attempt analyzed, so the client's Try again can
// resend it (there is no column for it, and the row still points at the
// untrimmed original when the run fails). Detail is internal/diagnostic
// only and is never shown to the golfer. It goes through redactDetail()
// here, at the sink, so a caller that forgets can't store a URL or secret.
export function formatFailure(code: CaddieFailureCode, detail: string, window?: TrimWindow): string {
  const windowToken = window ? ` window:${window.startSeconds.toFixed(3)}-${window.endSeconds.toFixed(3)}` : "";
  return `code:${code}${windowToken} ${redactDetail(detail, MAX_ERROR_MESSAGE_CHARS)}`.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

// ---- Safe diagnostics ----
// Anything written to caddie_analyses (owner-readable), a private
// diagnostics row or a log line goes through these. Two layers:
//  1. Callers never pass raw error text from fetch/ffmpeg/providers: a
//     thrown error contributes only its class name (safeErrorName) and a
//     provider body only allow-listed tokens (providerErrorHint). Deno's
//     fetch errors embed the request URL, which for Gemini used to carry
//     ?key=<API key> and for Storage a signed-URL token; ffmpeg's stderr
//     can carry a phone video's QuickTime metadata (GPS location, device).
//  2. redactDetail() is the safety net over whatever text remains.
const DEFAULT_DETAIL_CHARS = 300;

const REDACTIONS: [RegExp, string][] = [
  [/https?:\/\/[^\s"'<>)\]}]+/gi, "[url]"],
  [/\b(key|api_key|apikey|token|access_token|refresh_token|signature|sig|secret|password|x-goog-api-key)=([^&\s"'\\]+)/gi, "$1=[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\bAIza[0-9A-Za-z_-]{16,}/g, "[redacted-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[jwt]"],
  [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "[id]"],
  [/[+-]\d{1,3}\.\d{2,}[+-]\d{1,3}\.\d{2,}(?:[+-][\d.]+)?\/?/g, "[coords]"],
  [/com\.apple\.quicktime\.[A-Za-z0-9.]+\s*:[^\n\\]*/g, "[qt-meta]"],
  [/\b(location|make|model|software|creation_time|encoder|handler_name)\b[^:\n\\]{0,40}:[^\n\\]*/gi, "[meta]"],
  [/\/(?:tmp|var|home|usr|Users|private|root)\/[^\s"'\\]+/g, "[path]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function redactDetail(text: unknown, maxChars = DEFAULT_DETAIL_CHARS): string {
  if (text === null || text === undefined) return "";
  let out = typeof text === "string" ? text : String(text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  out = out.replace(/\s+/g, " ").trim();
  return out.length > maxChars ? `${out.slice(0, Math.max(0, maxChars - 1))}…` : out;
}

// A thrown value's class only — never its message (see above).
export function safeErrorName(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name || "Error";
    return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? name : "Error";
  }
  return typeof err;
}

// Allow-listed, non-sensitive tokens from a provider/route error body:
// our own extract-frames/trim-video `{ error: "<token>" }`, Gemini's
// `{ error: { status: "RESOURCE_EXHAUSTED" } }`, and quota/credit/auth
// keywords from Roboflow's free-form bodies. Returns "" when nothing safe
// is found; the body itself is never returned.
const ROUTE_TOKEN = /^[a-z][a-z0-9_]{1,40}$/;
const PROVIDER_STATUS = /^[A-Z][A-Z_]{2,40}$/;
const KEYWORD_HINTS: [RegExp, string][] = [
  [/credit|cap[_ ]exceeded|billing|payment|insufficient|prepa(?:y|id)|depleted/i, "quota_or_credit"],
  [/quota|resource[_ ]exhausted/i, "quota_or_credit"],
  // Gemini's per-minute rate limits are ALSO 429 RESOURCE_EXHAUSTED "quota"
  // (and even mention "plan and billing"); these markers tell them apart
  // from an exhausted daily quota / depleted credits.
  [/per[ _-]?minute|PerMinute|\bRPM\b|\bTPM\b/i, "per_minute"],
  [/rate[_ ]?limit|too many requests/i, "rate_limited"],
  [/api[_ ]?key|unauthori[sz]ed|forbidden|permission/i, "auth"],
  [/not found|no longer available|deprecated/i, "not_found"],
  [/unsupported|mime|invalid argument|invalid_argument/i, "invalid_input"],
];

export function providerErrorHint(body: unknown): string {
  if (typeof body !== "string" || body.length === 0) return "";
  const tokens: string[] = [];
  try {
    const json = JSON.parse(body) as { error?: unknown; status?: unknown };
    const err = json?.error;
    if (typeof err === "string" && ROUTE_TOKEN.test(err)) tokens.push(err);
    if (err && typeof err === "object") {
      const status = (err as { status?: unknown }).status;
      if (typeof status === "string" && PROVIDER_STATUS.test(status)) tokens.push(status);
    }
  } catch {
    // Not JSON — keyword hints only.
  }
  for (const [pattern, hint] of KEYWORD_HINTS) {
    if (pattern.test(body) && !tokens.includes(hint)) tokens.push(hint);
  }
  return tokens.slice(0, 5).join(",");
}

// Transient provider statuses worth retrying (and that mean "busy, try
// again in a minute" if retries run out).
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

// Back-off before retry `attempt` (1-based). Honors a Retry-After header in
// seconds when the provider sends one, capped so a single frame/call can't
// eat the whole pipeline deadline.
export function backoffMs(attempt: number, baseMs: number, capMs: number, retryAfterHeader?: string | null): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.min(capMs, retryAfterSeconds * 1000);
  const exp = baseMs * 2 ** (attempt - 1);
  const jitter = exp * 0.25 * Math.random();
  return Math.min(capMs, Math.round(exp + jitter));
}

// ---- Pose-presence gate ----
// Fail the run with code:pose_not_found (before spending a Gemini call)
// when fewer than this fraction of the frames Roboflow answered show a
// usable body. Only meant to stop clips with no golfer in them: checked
// against the 50 latest completed production analyses (2026-10-31, read-only
// SQL Micky ran), real swings often have many empty frames before and after
// the swing -- 0.5 would have refused 21 of 50, while every analysis since
// 2026-09-08 is above 0.1 (the 12 with no body at all were all on
// 2026-09-06/07). Revisit once the eval set has "body found" labels.
export const POSE_PRESENCE_MIN_RATIO = 0.1;

// "Usable body" = both shoulders, both hips, and at least one wrist
// reliably detected. One wrist is enough because at address/impact the
// hands sit together on the grip and the far wrist is routinely occluded
// by the near one — requiring both would fail good face-on clips.
export function frameHasUsableBody(keypoints: Record<string, unknown>): boolean {
  const has = (name: string) => keypoints[name] !== undefined;
  return has("left_shoulder") && has("right_shoulder") && has("left_hip") && has("right_hip") && (has("left_wrist") || has("right_wrist"));
}

export function poseCoverage(frames: { keypoints: Record<string, unknown> }[]): { usable: number; total: number; ratio: number } {
  const usable = frames.filter((f) => frameHasUsableBody(f.keypoints)).length;
  return { usable, total: frames.length, ratio: frames.length === 0 ? 0 : usable / frames.length };
}

// Keypoints from frames extract-frames downscaled are mapped back to the
// source video's pixel space (what the replay overlay draws against —
// CaddieSwingReplay scales by video.videoWidth/videoHeight). A missing or
// invalid scale means the frame was not downscaled.
export function scaleKeypoints<T extends { x: number; y: number }>(keypoints: Record<string, T>, scale: unknown): Record<string, T> {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale === 1) return keypoints;
  const out: Record<string, T> = {};
  for (const [name, kp] of Object.entries(keypoints)) out[name] = { ...kp, x: kp.x * scale, y: kp.y * scale };
  return out;
}
