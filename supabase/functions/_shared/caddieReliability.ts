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

const MAX_ERROR_MESSAGE_CHARS = 800;

// `code:<code> [window:<start>-<end>] <detail>`. The window is the golfer-
// picked trim window this attempt analyzed, so the client's Try again can
// resend it (there is no column for it, and the row still points at the
// untrimmed original when the run fails). Detail is internal/diagnostic
// only and is never shown to the golfer.
export function formatFailure(code: CaddieFailureCode, detail: string, window?: TrimWindow): string {
  const windowToken = window ? ` window:${window.startSeconds.toFixed(3)}-${window.endSeconds.toFixed(3)}` : "";
  return `code:${code}${windowToken} ${detail}`.slice(0, MAX_ERROR_MESSAGE_CHARS);
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
