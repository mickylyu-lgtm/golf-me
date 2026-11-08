// Reusing a failed attempt's pose work on Try again (2026-11-08, Micky's
// "yes"). Pure helpers, no Deno/Supabase imports, so node --test can run
// them (tests/caddiePreprocessing.test.ts).
//
// What is kept: ONLY the trusted pose data analyze-swing hands Gemini
// (TRUSTED_POSE_DATA: per-frame keypoints in source-video pixels, phase
// metrics, timestamps). No video, no frame images, no trimmed copy: the
// failed attempt's trimmed copy is still removed exactly as before, and a
// Try again re-trims (seconds, no Roboflow credits) because the pose
// timestamps are relative to the same trim window.
//
// Where: private.caddie_preprocessing (migration 20261108160000), one row
// per analysis, no client access (RLS on, no policies, no grants), written
// and read only through owner-checked RPCs. Retention: deleted when the
// analysis completes (trigger), when the analysis or the account is deleted
// (FK cascade), and 7 days after it was written (daily pg_cron purge),
// whichever comes first; never used after it expires.
//
// Reuse needs ALL of: the same analysis row (primary key), the same source
// media (sha-256 of the private path / public URL: the URL itself is never
// stored), the same trim window, the same preprocessingVersion(), not
// expired, and a valid HMAC from analyze-swing's own server-only secret
// (FRAME_EXTRACT_SECRET). The RPCs are callable with the golfer's own JWT
// (that is how analyze-swing runs), so the signature is what stops a
// client from planting its own "pose data" for Gemini to read.

// analyze-swing builds its version string from everything that shapes the
// pose data (Roboflow workflow id, sampling fps, frame size, dense pass,
// pose gate) plus this schema tag; any change makes older checkpoints stop
// matching and the work is simply redone. Bump the tag for a change in the
// pose data's own shape.
export const PREPROCESSING_SCHEMA = "pose-v1";
export function preprocessingVersion(parts: (string | number)[]): string {
  return [...parts, PREPROCESSING_SCHEMA].join("|").slice(0, 200);
}
export const PREPROCESSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TrimWindowLike {
  startSeconds: number;
  endSeconds: number;
}

export interface PreprocessingCheckpoint {
  analysisId: string;
  attempt: number;
  sourceKey: string;
  trimStartSeconds: number | null;
  trimEndSeconds: number | null;
  pipelineVersion: string;
  pose: unknown;
  sig: string;
  createdAt: string;
}

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// The media this analysis reads: its private caddie-media path, else its
// public community-media URL. Hashed, so no URL or path is stored here.
export function sourceKey(source: string): Promise<string> {
  return sha256Hex(`source:${source}`);
}

// Trim windows are compared at millisecond precision (how analyze-swing
// rounds and stores them).
function windowToken(start: number | null, end: number | null): string {
  return start === null || end === null ? "none" : `${start.toFixed(3)}-${end.toFixed(3)}`;
}

export function trimFields(window: TrimWindowLike | undefined): { trimStartSeconds: number | null; trimEndSeconds: number | null } {
  return window ? { trimStartSeconds: window.startSeconds, trimEndSeconds: window.endSeconds } : { trimStartSeconds: null, trimEndSeconds: null };
}

// JSON with object keys sorted at every level: Postgres jsonb reorders keys
// (and the round trip through it must not break the signature).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function payload(c: Omit<PreprocessingCheckpoint, "sig" | "createdAt">): Promise<string> {
  const poseHash = await sha256Hex(canonicalJson(c.pose));
  return [c.analysisId, c.attempt, c.sourceKey, windowToken(c.trimStartSeconds, c.trimEndSeconds), c.pipelineVersion, poseHash].join("|");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(`caddie-preprocessing:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signCheckpoint(secret: string, c: Omit<PreprocessingCheckpoint, "sig" | "createdAt">): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(await payload(c))));
}

export type ReuseVerdict = "reuse" | "none" | "other_source" | "other_window" | "other_version" | "expired" | "bad_signature" | "malformed";

// Whether a stored checkpoint may stand in for this attempt's pose work.
export async function checkpointVerdict(
  secret: string,
  stored: PreprocessingCheckpoint | null | undefined,
  expected: { analysisId: string; sourceKey: string; window: TrimWindowLike | undefined; version: string },
  now: number = Date.now(),
): Promise<ReuseVerdict> {
  if (!stored) return "none";
  const pose = stored.pose as { frames?: unknown; video?: unknown } | null;
  if (!pose || typeof pose !== "object" || !Array.isArray(pose.frames) || pose.frames.length === 0 || typeof pose.video !== "object") return "malformed";
  if (stored.analysisId !== expected.analysisId || stored.sourceKey !== expected.sourceKey) return "other_source";
  const want = trimFields(expected.window);
  if (windowToken(stored.trimStartSeconds, stored.trimEndSeconds) !== windowToken(want.trimStartSeconds, want.trimEndSeconds)) return "other_window";
  if (stored.pipelineVersion !== expected.version) return "other_version";
  const created = Date.parse(stored.createdAt);
  if (!Number.isFinite(created) || now - created > PREPROCESSING_TTL_MS) return "expired";
  const expectedSig = await signCheckpoint(secret, stored);
  if (!timingSafeEqualHex(expectedSig, stored.sig)) return "bad_signature";
  return "reuse";
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Sampled thinking-level experiment (2026-11-08) ----
// CADDIE_THINKING_LOW_SAMPLE = a fraction 0..1 (unset/0 = off). Each
// ATTEMPT is in or out, decided from a hash of row id + attempt so every
// generateContent try of that attempt uses the same level and the choice
// can be re-derived later. "low" = thinkingConfig.thinkingLevel "low";
// "default" = no thinkingConfig at all (exactly the pre-experiment request).
export type ThinkingArm = "default" | "low";

export function parseSampleRate(raw: string | undefined | null): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0;
}

export async function thinkingArmFor(analysisId: string, attempt: number, sampleRate: number): Promise<ThinkingArm> {
  if (sampleRate <= 0) return "default";
  const h = await sha256Hex(`thinking:${analysisId}:${attempt}`);
  const bucket = parseInt(h.slice(0, 8), 16) / 0x1_0000_0000; // uniform in [0, 1)
  return bucket < sampleRate ? "low" : "default";
}
