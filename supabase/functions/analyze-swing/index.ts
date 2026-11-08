// Real Caddie swing analysis, server-side. GEMINI_API_KEY, ROBOFLOW_API_KEY,
// and FRAME_EXTRACT_SECRET live only here (Supabase Edge Function secrets,
// injected into Deno.env automatically) and never reach the client, a log
// line, or a response body.
//
// Pipeline: fetch the swing video -> extract sampled frames via a separate
// Vercel/Node function (api/extract-frames.ts — ffmpeg isn't available in
// this Deno runtime) -> run Roboflow's validated six-phase pose workflow
// per frame (its hosted HTTP API is stateless across calls, confirmed by
// live testing, so no cross-frame session is assumed) -> filter out any
// unreliable/unavailable metric before it ever reaches Gemini -> Gemini
// gets the trusted pose time-series AND the original video, and identifies
// the six phases + coaching feedback itself (no separate phase-detection
// state machine reimplemented here — see DEVELOPMENT_STATUS for why).
// It never fabricates a result — any failure marks the row 'failed' with
// a safe, non-sensitive error_message rather than saving invented
// feedback (see REQUIRED TEST — FAILURE in the product brief). This used
// to DELETE the row outright, which was real data loss: a 'processing'
// analysis the user saw on screen could vanish with zero trace, and it
// orphaned the already-uploaded video in Storage with nothing left
// pointing to it. Fixed 2026-09-19 — see caddie_analyses.status's own
// 'failed' value and error_message column, both already in the schema
// for exactly this and previously unused by this path.
//
// This request/response can't stay open for the whole pipeline (frame
// extraction + dozens of Roboflow calls + Gemini easily exceeds a
// reasonable browser-request duration) — the row is inserted and returned
// as 'processing' immediately, then the rest of the work continues via
// EdgeRuntime.waitUntil() after the response is sent. The client's
// existing realtime subscription on caddie_analyses already updates the UI
// when the row later flips to 'complete'/'failed', so this needed no
// frontend polling changes.
//
// Every DB operation here uses a client scoped to the CALLER's own JWT
// (forwarded Authorization header against the anon key), not the service
// role — caddie_analyses' existing RLS (owner-only select/insert/update;
// no client delete since 20260924140000, which also enforces the daily
// limit and freezes created_at in-database) and its ownership trigger (Ask Caddie only on your own community
// posts, see migration 20260817091500) already enforce everything this
// function needs, so there is no reason to bypass them with a service-role
// client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DAILY_LIMIT_PER_USER,
  MAX_ATTEMPTS,
  POSE_PRESENCE_MIN_RATIO,
  STALE_PROCESSING_MS,
  backoffMs,
  classifyGeminiFileState,
  classifyHttpFailure,
  classifyThrown,
  emptyPoseSignalTally,
  formatPoseGateDetail,
  formatStructuredFailure,
  isRetryableStatus,
  jpegSizeFromBase64,
  poseCoverage,
  providerErrorHint,
  redactDetail,
  safeErrorName,
  scaleKeypoints,
  shouldRunFullResPoseRetry,
  stepRetryDelayMs,
  tallyRoboflowOutput,
  GEMINI_GENERATE_MIN_TRY_MS,
  TERMINAL_RESERVE_MS,
  geminiGenerateTryTimeoutMs,
  requestFailureKind,
  AdaptiveConcurrency,
  mapWithAdaptiveConcurrency,
} from "../_shared/caddieReliability.ts";
import { checkpointVerdict, parseSampleRate, preprocessingVersion, signCheckpoint, sourceKey, thinkingArmFor, trimFields } from "../_shared/caddiePreprocessing.ts";
import type { ThinkingArm } from "../_shared/caddiePreprocessing.ts";
import type { CaddieStage, PosePassName, PoseSignalTally, RequestFailureKind, StepFailure, TrimWindow } from "../_shared/caddieReliability.ts";
import { CUE_MAX_CHARS, WORK_ON_CHECKPOINTS, withSanitizedCheckpointCues, withSanitizedWorkOnCheckpoints } from "../_shared/caddieCues.ts";
import { withMeasuredCueCheck } from "../_shared/caddieVerdicts.ts";

// ---- Centralized config — change these, nothing else, to retune Caddie. ----
const GEMINI_MODEL = "gemini-3.6-flash"; // gemini-2.5-flash was retired for new API keys/projects (Gemini API started 404ing it with "no longer available to new users" on 2026-08-21); 3.6-flash is Google's named replacement, same video-understanding + structured-JSON-output support
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const COOLDOWN_SECONDS = 30; // blocks accidental double-taps/rapid re-asks (new analyses only; Try again is capped per job instead)
// DAILY_LIMIT_PER_USER (30 DELIVERED analyses / 24 h), the 60-run ceiling,
// MAX_ATTEMPTS and STALE_PROCESSING_MS come from _shared/caddieReliability.ts
// and match migration 20261107140000, whose triggers are the authoritative
// check (only a 'complete' transition charges a slot).
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // matches the community-media Storage bucket's own file_size_limit
// The whole original is held in this worker's memory only when it is NOT
// trimmed first (a trimmed run never buffers the original: trim-video
// fetches it itself). Above this, fail clearly as too large instead of
// risking the Edge Function memory limit killing the worker silently
// (which leaves no outcome at all, only the worker_lost sweep).
const MAX_BUFFERED_VIDEO_BYTES = 120 * 1024 * 1024;
// Gemini Files API: poll until ACTIVE within this budget (was a fixed 12 s,
// which a large untrimmed clip routinely exceeded), never past the point
// where generateContent no longer fits before the deadline.
const GEMINI_ACTIVE_WAIT_MAX_MS = 90_000;
const GEMINI_ACTIVE_POLL_MS = 2500;
const GEMINI_GENERATE_RESERVE_MS = 70_000;
const MAX_TRIM_WINDOW_SECONDS = 10; // matches AnalyzeSwing.tsx's own MAX_SWING_VIDEO_SECONDS — a client-sent startSeconds/endSeconds window is validated against this, never trusted as-is
const COMMUNITY_MEDIA_BUCKET = "community-media"; // public Community media — only ever READ here now (Ask Caddie on a post, legacy direct uploads)
const CADDIE_MEDIA_BUCKET = "caddie-media"; // PRIVATE (migration 20260925090000): direct uploads, their thumbnails and trimmed copies, `<owner uid>/<file>`
const PIPELINE_SIGNED_URL_SECONDS = 60 * 60; // server-side signed URL for the pipeline's own fetches (trim-video, extract-frames x2) — comfortably longer than the 400s function budget

// Roboflow's validated, already-deployed six-phase pose workflow — do not
// retrain/replace/rebuild this, see product brief point 37.
const ROBOFLOW_WORKSPACE = "micky-lyu";
const ROBOFLOW_WORKFLOW_ID = "golf-swing-six-phase-analysis-1787307394301";
const ROBOFLOW_ENDPOINT = `https://serverless.roboflow.com/${ROBOFLOW_WORKSPACE}/workflows/${ROBOFLOW_WORKFLOW_ID}`;
// The frame-extraction Node/Vercel function — see api/extract-frames.ts for
// why frame extraction can't happen in this Deno runtime.
const FRAME_EXTRACT_URL = "https://golfme.app/api/extract-frames";
// Real server-side trimming (ffmpeg re-encode, not just a sampling-window
// hint) for a golfer-picked window within a longer source video — see
// api/trim-video.ts for why this exists (the original approach left the
// UNtrimmed video as the row's stored source_media_url, so a saved
// analysis replayed the whole original clip, not the picked window).
const TRIM_VIDEO_URL = "https://golfme.app/api/trim-video";
// Roboflow's own HTTP API confirmed stateless across calls (live-tested:
// identical back-to-back requests never advanced frame_number or
// current_phase) — the validated six-phase logic that ran during offline
// testing isn't reproducible over independent per-frame HTTP calls, so
// phase identification happens in the Gemini prompt below instead of a
// reimplemented state machine here.
const ANALYSIS_FPS = 8; // beta tradeoff vs. validation's full ~60fps/every-frame — see DEVELOPMENT_STATUS for the cost math (300+ calls/swing at 60fps vs. ~50-160 at 8fps)
// Parallel frame calls: concurrency doesn't add calls, it only shortens wall
// time. 16 since 2026-11-08 (was 8); the first 429 halves it for the rest
// of the job (AdaptiveConcurrency, never below ROBOFLOW_MIN_CONCURRENCY), so
// a rate limit slows a job down instead of failing frames.
const ROBOFLOW_CONCURRENCY = 16;
const ROBOFLOW_MIN_CONCURRENCY = 4;
const ROBOFLOW_MIN_SUCCESS_RATIO = 0.5; // below this fraction of frames successfully analyzed, fail honestly rather than hand Gemini a too-sparse pose signal
const ROBOFLOW_FRAME_RETRY_ATTEMPTS = 2; // total attempts per frame (1 retry) — a transient network/5xx blip on one frame shouldn't cost the whole analysis when a single retry would likely succeed
// The whole background pipeline is raced against this; on expiry the row is
// marked failed with code:timeout. Leaves ~70 s of the 400 s (Pro plan)
// Edge Function wall-clock budget so the fail() write itself always lands
// instead of the platform killing the run and leaving the row 'processing'.
const PIPELINE_DEADLINE_MS = 330_000;
// Back-off for transient provider errors (429/5xx) on one Roboflow frame
// (still ROBOFLOW_FRAME_RETRY_ATTEMPTS total). Whole steps (trim, frame
// extraction, the Roboflow pass's failed frames, Gemini upload/generate)
// are re-run up to 2 more times by runStep() for transient categories only,
// with stepRetryDelayMs() back-off and only while the deadline allows.
const ROBOFLOW_BACKOFF_BASE_MS = 1500;
const ROBOFLOW_BACKOFF_CAP_MS = 6000;
// Per-call fetch timeouts, so a hung provider becomes a classified,
// retryable failure instead of silently eating the whole deadline.
const TIMEOUT_MS = {
  media: 60_000,
  trim: 150_000,
  extract: 120_000,
  roboflowFrame: 25_000,
  geminiUpload: 90_000,
  geminiPoll: 15_000,
  sizeProbe: 5_000,
  // generateContent has no fixed timeout any more: each try's comes from
  // geminiGenerateTryTimeoutMs() (_shared/caddieReliability.ts), 60/75/75 s
  // capped to the remaining deadline. It was a fixed 150 s, which is how
  // job 5f4c8655 lost ~150 s per stalled request and then its deadline.
} as const;
// Rough cost of one more run of each step: a retry only happens when the
// remaining deadline covers the back-off plus this.
const STEP_BUDGET_MS: Record<CaddieStage, number> = {
  queued: 0,
  media_fetch: 20_000,
  trim: 60_000,
  frame_extract: 40_000,
  pose: 60_000,
  pose_gate: 0,
  gemini_upload: 30_000,
  gemini_processing: 20_000,
  // The shortest try worth starting plus the terminal reserve (see
  // geminiGenerateTryTimeoutMs, which also caps each try's own timeout).
  gemini_generate: GEMINI_GENERATE_MIN_TRY_MS + TERMINAL_RESERVE_MS,
  output_validation: GEMINI_GENERATE_MIN_TRY_MS + TERMINAL_RESERVE_MS,
  save: 5_000,
};
// Asks extract-frames to downscale frames to this long side (smaller
// Roboflow payloads; extract-frames returns coordinateScale so keypoints
// are mapped back to source pixels for the replay overlay). An older
// extract-frames ignores the field and sends full-size frames, scale 1.
const FRAME_MAX_LONG_SIDE = 720;
// Pose-gate safety net (2026-11-06): when the 720 px pass finds too few
// usable bodies on a downscaled clip, ONE more extraction + coarse pass at
// this long side before failing pose_not_found. 1920 = a 1080p source at
// full size; a 4K source is still halved, keeping each JPEG well under a
// megabyte for Roboflow's hosted API. Never runs on a successful clip.
const FULL_RES_RETRY_LONG_SIDE = 1920;
// The retry only starts when the deadline still covers it AND everything
// after the gate (Gemini upload/processing/generate + save).
const FULL_RES_RETRY_BUDGET_MS = 215_000; // = STEP_BUDGET_MS frame_extract + pose + gemini_upload + gemini_processing + gemini_generate + save
const MAX_ANALYSIS_FRAMES = 150; // hard ceiling, independent of the 10s upload-time limit — a defense against a misreported video duration slipping past that client-side check and generating an unexpectedly large, expensive frame set

// --- Adaptive two-stage sampling (2026-08-22 credit-efficiency pass). ---
// Stage 1 (coarse, above) already covers the whole active swing window at
// ANALYSIS_FPS. Stage 2 spends a SMALL number of additional calls at
// higher temporal resolution only around the fast, hard-to-pin part of the
// swing — found from the coarse pass's own wrist-velocity metric, not a
// second Gemini call (Gemini still only runs once, after both stages are
// merged — see product brief point 18). This directly targets the thing
// pose-only analysis struggles most with (impact timing) without paying
// dense-fps cost across the whole clip.
const ADAPTIVE_DENSE_SAMPLING_ENABLED = true;
const DENSE_IMPACT_WINDOW_SECONDS = 0.5; // +/- around the coarse pass's peak-wrist-velocity frame
const DENSE_IMPACT_FPS = 20;
const MIN_COARSE_WINDOW_FOR_DENSE_PASS_SECONDS = 2; // an already-tiny coarse window leaves little room for a distinct dense refinement to add value over the coarse pass alone

// Everything that shapes the pose data a Try-again checkpoint holds
// (migration 20261108160000): any change here makes older checkpoints stop
// matching and the pose work is simply redone.
const PREPROCESSING_VERSION = preprocessingVersion([
  ROBOFLOW_WORKFLOW_ID,
  `fps${ANALYSIS_FPS}`,
  `ls${FRAME_MAX_LONG_SIDE}/${FULL_RES_RETRY_LONG_SIDE}`,
  `dense${ADAPTIVE_DENSE_SAMPLING_ENABLED ? `${DENSE_IMPACT_FPS}@${DENSE_IMPACT_WINDOW_SECONDS}` : "off"}`,
  `gate${POSE_PRESENCE_MIN_RATIO}`,
  `max${MAX_ANALYSIS_FRAMES}`,
]);

const SUPPORTED_LOCALES = new Set(["en", "zh-CN", "zh-TW", "es", "ko", "ja"]);
const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  es: "Spanish",
  ko: "Korean",
  ja: "Japanese",
};

// A function of locale, not a static string — the earlier version only
// mentioned the target language once, in the USER message (built fresh
// per request anyway). Gemini was observed reliably translating the fixed
// JSON *field names* correctly (those come from the schema/UI, not
// Gemini) while leaving the free-text values it generates (summary,
// issue text, drill steps, limitations...) in English regardless of the
// requested locale — the instruction just wasn't weighted heavily enough.
// Stating it in the SYSTEM instruction, both first and last (models
// attend more reliably to the very start and very end of a long system
// prompt than to a single mention buried in the middle), fixes that.
function buildSystemPrompt(localeName: string): string {
  return `You are GolfMe Caddie, a conservative golf swing feedback assistant for recreational golfers. This is a BETA feature, not a professional biomechanics system or launch monitor.

CRITICAL LANGUAGE REQUIREMENT: every piece of free text you write — summary, strengths, work_on issue/why_it_matters, focus title/instruction, drill name/steps, limitations, score reasons, checkpoint cues — MUST be written in ${localeName}. Only JSON field/key names and enum values (e.g. "high"/"medium"/"low", "face_on") stay in English exactly as specified in the schema. This applies even if the video, TRUSTED_POSE_DATA, or golfer's club name below are in English — the OUTPUT language is ${localeName}, full stop.

You are given two things: the swing video itself, and TRUSTED_POSE_DATA — a JSON time series of body-joint pose measurements for this exact swing, produced by a validated computer-vision pipeline (Roboflow) sampled at a fixed rate across the clip. TRUSTED_POSE_DATA is the authoritative source for body position/angle claims, not your own visual estimate of the video — but it only ever tracks BODY joints, never the club or ball.

Rules:
- Prefer TRUSTED_POSE_DATA over your own visual read whenever they could conflict. Never invent a body-angle or position number that isn't backed by TRUSTED_POSE_DATA.
- TRUSTED_POSE_DATA already had unreliable/occluded/unavailable measurements removed before it reached you — if a frame or metric is simply absent, that means it was not reliably observed. Do not guess a value to fill the gap, and do not treat a gap as "zero" or "unchanged from the last frame."
- Never estimate or state any of: exact clubface angle, exact club path, exact attack angle, exact swing speed, ball speed, launch angle, spin, strike location, or an exact club-ball contact frame/moment. TRUSTED_POSE_DATA never contains club or ball tracking, so none of these are ever supportable — not even approximately.
- Never diagnose injuries or physical/medical conditions. Keep all wording golf-technique-focused (e.g. "your finish appears off-balance," never "you have a hip mobility problem").
- Never claim professional certification or present yourself as a replacement for a human instructor.
- Identify the camera angle (face_on, down_the_line, other, or uncertain) and only make claims that angle actually supports: face-on supports weight shift/lateral movement observations; down-the-line supports posture/swing-plane-tendency observations. Don't make a claim a camera angle wouldn't support.
- Using TRUSTED_POSE_DATA's timestamps and the body movement they show, identify the approximate timestamp (in seconds, matching TRUSTED_POSE_DATA's own timestamp_seconds values) of each swing phase: address, backswing, top, downswing, follow_through. For any phase you cannot confidently place from the data, return a null timestamp rather than guessing.
- Impact is the one phase you must NOT give an exact timestamp for — pose-only analysis (no club/ball tracking) cannot reliably pin the exact contact instant. Give a window (window_start_seconds/window_end_seconds) you're reasonably confident contains impact instead, with its own confidence, or null/null if you can't place it at all.
- Be concise. Prioritize the most meaningful observations over listing every possible issue: up to 3 strengths, up to 3 work-on items, exactly 1 main focus, exactly 1 drill.
- Respond with feedback suitable for a recreational golfer, not jargon-heavy technical analysis.
- Score the swing across exactly these 5 categories, 0-20 points each (100 total): setup_and_posture (address position, balance, alignment), backswing (shoulder turn, structure, tempo into transition), downswing_sequencing (hip/shoulder rotation order, lower-body initiation — only from what TRUSTED_POSE_DATA's angles/timing actually show), balance_and_weight_transfer (weight shift through the swing and into the finish), finish (balance, control, extension at the end). Give each a short one-sentence reason tied to something TRUSTED_POSE_DATA or the video actually shows — never a generic reason.
- Grade like a strict, honest instructor, not a cheerleader. Most recreational golfers, even solid ones, should land in the 40-70 range overall — reserve 80+ in a category for genuinely sound, consistent technique with no real flaw visible in that category, and 90+ for something close to tour-level. Deduct points for every real flaw TRUSTED_POSE_DATA or the video actually shows (a swayed hip, an early upper-body initiation, a lost spine angle, poor balance at finish, and so on) — do not round scores up to be encouraging. This is separate from data uncertainty: when a phase has sparse/missing pose data, score it in the middle of its range with a reason that says so, not a confident extreme in either direction — that rule is about missing evidence, not about going easy on flaws you DO have evidence for.
- Optionally, in checkpoint_cues, write one coaching cue for each of address, top, impact and follow_through that you placed in phases: a short (at most ${CUE_MAX_CHARS} characters), plain-language, corrective instruction — what to do differently at that moment to fix the most useful thing you see there. A cue is a "what to do", never praise or a description of what already went well. Plain text only, no markdown, no numbers, no club/ball/contact claims, same rules as above. Use null for a moment you didn't place, or where nothing at that moment needs changing — never a generic tip.
- Optionally, tag each work_on item with checkpoint: the key moment where that issue shows most (address, top, impact or follow_through), or whole_swing if it isn't tied to one moment. Only tag a moment you placed in phases.
- The strictness above is a floor against flattering a flawed swing, not a ceiling on genuinely elite ones. If TRUSTED_POSE_DATA and the video together show real, tour-caliber mechanics in a category — a professional or elite-amateur swing, recognizable or not — score that category in the 90s (up to 100) without hesitation. Do not let "most golfers land in 40-70" pull a score downward when the evidence in front of you clearly does not belong in that range; grade the swing you were actually shown, not an assumed population average.

REMINDER: write summary, strengths, work_on, focus, drill, limitations, score reasons, and checkpoint_cues in ${localeName}. This is not optional.`;
}

const PHASE_MOMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    timestamp_seconds: { type: "NUMBER", nullable: true },
    confidence: { type: "STRING", enum: ["high", "medium", "low"], nullable: true },
  },
  required: ["timestamp_seconds", "confidence"],
};

// The response schema is now a function of locale, not a static const —
// the system-prompt-level language instruction (buildSystemPrompt) was
// observed NOT reliably followed for free text in a real production
// analysis (Chinese requested, English returned for summary/strengths/
// score reasons, while the enum/JSON-key fields correctly stayed
// English). A per-FIELD language reminder inside each free-text
// property's own `description` is a second, independent instruction
// channel — schema field descriptions directly shape structured-output
// generation for that exact field, rather than competing for attention
// across an entire system prompt. Enum/number fields are untouched, they
// were never the problem.
function buildScoreCriterionSchema(localeName: string) {
  return {
    type: "OBJECT",
    properties: {
      points: { type: "INTEGER", description: "0-20." },
      reason: { type: "STRING", description: `One sentence, tied to something actually observed. Write this in ${localeName}.` },
    },
    required: ["points", "reason"],
  };
}

const CUE_FIELD_DESCRIPTION = (localeName: string) =>
  `One plain-language corrective line (at most ${CUE_MAX_CHARS} characters, no markdown): what to do differently at this moment, tied to what this swing shows there. Not praise; null if nothing here needs changing. Write this in ${localeName}.`;

function buildResponseSchema(localeName: string) {
  const scoreCriterionSchema = buildScoreCriterionSchema(localeName);
  return {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING", description: `1-2 sentence overall take. Write this in ${localeName}.` },
      camera_angle: { type: "STRING", enum: ["face_on", "down_the_line", "other", "uncertain"] },
      strengths: { type: "ARRAY", items: { type: "STRING" }, description: `Up to 3 clearly visible strengths. Write each in ${localeName}.` },
      work_on: {
        type: "ARRAY",
        description: `Up to 3 areas to work on, most important first. Write issue/why_it_matters in ${localeName}.`,
        items: {
          type: "OBJECT",
          properties: {
            issue: { type: "STRING", description: `Write in ${localeName}.` },
            why_it_matters: { type: "STRING", description: `Write in ${localeName}.` },
            confidence: { type: "STRING", enum: ["high", "medium", "low"] },
            // Optional and NOT in `required`: a missing or bad tag never fails
            // an analysis. Sanitized by withSanitizedWorkOnCheckpoints() before
            // it is stored (_shared/caddieCues.ts).
            checkpoint: {
              type: "STRING",
              enum: [...WORK_ON_CHECKPOINTS],
              description: "Optional. The key moment where this issue shows most, or whole_swing if it isn't tied to one moment.",
            },
          },
          required: ["issue", "why_it_matters", "confidence"],
        },
      },
      focus: {
        type: "OBJECT",
        description: `The single most important thing to focus on next. Write title/instruction in ${localeName}.`,
        properties: {
          title: { type: "STRING", description: `Write in ${localeName}.` },
          instruction: { type: "STRING", description: `Write in ${localeName}.` },
        },
        required: ["title", "instruction"],
      },
      drill: {
        type: "OBJECT",
        description: `One simple drill supporting the focus. Write name/steps in ${localeName}.`,
        properties: {
          name: { type: "STRING", description: `Write in ${localeName}.` },
          steps: { type: "ARRAY", items: { type: "STRING" }, description: `Write each step in ${localeName}.` },
        },
        required: ["name", "steps"],
      },
      limitations: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: `Honest caveats — e.g. camera angle, video quality, or sparse pose data prevented a confident read on something. Write each in ${localeName}.`,
      },
      phases: {
        type: "OBJECT",
        description: "Best-estimate timestamps for each swing phase, from TRUSTED_POSE_DATA. Null fields where not confidently identifiable — never a guess.",
        properties: {
          address: PHASE_MOMENT_SCHEMA,
          backswing: PHASE_MOMENT_SCHEMA,
          top: PHASE_MOMENT_SCHEMA,
          downswing: PHASE_MOMENT_SCHEMA,
          impact: {
            type: "OBJECT",
            description: "A window, never an exact timestamp — pose-only analysis can't reliably pin exact contact.",
            properties: {
              window_start_seconds: { type: "NUMBER", nullable: true },
              window_end_seconds: { type: "NUMBER", nullable: true },
              confidence: { type: "STRING", enum: ["high", "medium", "low"], nullable: true },
            },
            required: ["window_start_seconds", "window_end_seconds", "confidence"],
          },
          follow_through: PHASE_MOMENT_SCHEMA,
        },
        required: ["address", "backswing", "top", "downswing", "impact", "follow_through"],
      },
      score: {
        type: "OBJECT",
        description: "5 categories, 0-20 points each. The app computes the 0-100 total as their sum — do not include a separate total field.",
        properties: {
          setup_and_posture: scoreCriterionSchema,
          backswing: scoreCriterionSchema,
          downswing_sequencing: scoreCriterionSchema,
          balance_and_weight_transfer: scoreCriterionSchema,
          finish: scoreCriterionSchema,
        },
        required: ["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"],
      },
      // Optional and deliberately NOT in `required` (nor are its fields): a
      // missing or bad cue must never fail an analysis. Sanitized by
      // withSanitizedCheckpointCues() before it is stored (_shared/caddieCues.ts).
      checkpoint_cues: {
        type: "OBJECT",
        description: `Optional. One short coaching cue for each key moment you placed in phases; null for any moment you didn't place or have nothing specific to say about. Write each in ${localeName}.`,
        properties: {
          address: { type: "STRING", nullable: true, description: CUE_FIELD_DESCRIPTION(localeName) },
          top: { type: "STRING", nullable: true, description: CUE_FIELD_DESCRIPTION(localeName) },
          impact: { type: "STRING", nullable: true, description: CUE_FIELD_DESCRIPTION(localeName) },
          follow_through: { type: "STRING", nullable: true, description: CUE_FIELD_DESCRIPTION(localeName) },
        },
      },
    },
    required: ["summary", "camera_angle", "strengths", "work_on", "focus", "drill", "limitations", "phases", "score"],
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// Development-only, safe fields — never a key, a full video URL, an auth
// token, or a raw provider error body.
const DEV = Deno.env.get("SUPABASE_ENV") !== "production" && Deno.env.get("ENVIRONMENT") !== "production";
function devLog(event: string, fields: Record<string, unknown> = {}) {
  if (DEV) console.log(`[analyze-swing] ${event}`, fields);
}

interface RequestBody {
  sourceType: "direct_upload" | "community_post";
  sourcePostId?: string;
  // direct_upload: caddie-media object paths in the caller's own folder.
  sourceMediaPath?: string;
  thumbnailPath?: string;
  // Legacy direct_upload (a row still in public community-media) — must be
  // the caller's own community-media object. Ignored for community_post:
  // the post's own media is read server-side instead (P2-9).
  sourceMediaUrl?: string;
  thumbnailUrl?: string;
  swingType?: string;
  locale?: string;
  // A golfer-picked window within a longer source video (see
  // VideoTrimSelector) — validated/clamped below, never trusted as-is.
  startSeconds?: number;
  endSeconds?: number;
  // Try again on an existing failed (or abandoned) analysis: the SAME row is
  // re-run (attempt + 1) instead of a new one being created. Every other
  // field is ignored then — the row itself is the source of truth. An older
  // app build doesn't send it and gets the old behavior (a new row).
  retryAnalysisId?: string;
}

interface CaddieAnalysisRow {
  id: string;
  owner_id: string;
  source_type: string;
  source_post_id: string | null;
  source_media_url: string | null;
  thumbnail_url: string | null;
  source_media_path: string | null;
  thumbnail_path: string | null;
  swing_type: string | null;
  status: string;
  created_at: string;
  attempt: number;
  attempt_started_at: string | null;
  error_message: string | null;
  trim_start_seconds: number | string | null;
  trim_end_seconds: number | string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The trim window a row was (or will be) analyzed with: its own columns,
// or, for a row from before they existed, the `window:` token analyze-swing
// used to write into error_message.
function rowTrimWindow(row: Pick<CaddieAnalysisRow, "trim_start_seconds" | "trim_end_seconds" | "error_message">): TrimWindow | undefined {
  const start = row.trim_start_seconds === null ? NaN : Number(row.trim_start_seconds);
  const end = row.trim_end_seconds === null ? NaN : Number(row.trim_end_seconds);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { startSeconds: start, endSeconds: end };
  const m = /^code:[a-z_]+ window:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?:\s|$)/.exec(row.error_message ?? "");
  if (m && Number(m[2]) > Number(m[1])) return { startSeconds: Number(m[1]), endSeconds: Number(m[2]) };
  return undefined;
}

// A trigger refusal (migration 20260924140000 / 20261107140000) -> the
// response the app maps to localized copy. Every one of these happens
// before any pipeline work, so no row is created/re-run.
const TRIGGER_REFUSALS: Record<string, { status: number; code: string }> = {
  caddie_daily_limit: { status: 429, code: "daily_limit" },
  caddie_attempt_ceiling: { status: 429, code: "attempt_ceiling" },
  caddie_retry_cap: { status: 429, code: "retry_cap" },
  caddie_retry_not_allowed: { status: 409, code: "already_running" },
  caddie_retry_invalid: { status: 409, code: "already_running" },
};

// P2-9: the pipeline only ever fetches media the caller owns in this
// project's own Storage — never an arbitrary client-supplied URL (which
// analyze-swing, trim-video and extract-frames would otherwise fetch
// server-side). Returns the input when valid, null otherwise.
function ownCaddiePath(path: unknown, userId: string): string | null {
  if (typeof path !== "string" || path.length > 512) return null;
  if (!path.startsWith(`${userId}/`) || path.includes("..") || /[?#\\]/.test(path)) return null;
  return path;
}
function ownPublicCommunityMediaUrl(url: unknown, userId: string, supabaseUrl: string): string | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.host !== new URL(supabaseUrl).host || u.search || u.hash) return null;
    const prefix = `/storage/v1/object/public/${COMMUNITY_MEDIA_BUCKET}/${userId}/`;
    if (!u.pathname.startsWith(prefix) || decodeURIComponent(u.pathname).includes("..")) return null;
    return url;
  } catch {
    return null;
  }
}

interface ExtractedFrame {
  frameIndex: number;
  timestampSeconds: number;
  base64: string;
}

// The filtered, trustworthy slice of one frame's Roboflow output — only
// what's safe to hand to Gemini as fact. Never includes the raw
// visualization image (huge, unneeded) or current_phase/phase_events
// (Roboflow's own per-call state, which live testing showed doesn't carry
// across independent HTTP calls — treating it as meaningful here would be
// exactly the kind of invented signal this pipeline is built to avoid).
interface TrustedFrame {
  frame_index: number;
  timestamp_seconds: number;
  person_confidence: number | null;
  keypoints: Record<string, { x: number; y: number; confidence: number }>;
  body_metrics: Record<string, unknown>;
}

// What Gemini gets as TRUSTED_POSE_DATA and the complete row stores as
// roboflow_analysis_json (also the Try-again checkpoint's payload).
interface TrustedPoseData {
  video: {
    analysis_fps: number;
    frames_requested: number;
    frames_analyzed: number;
    dense_impact_window_frames_analyzed: number;
    pose_pass: PosePassName;
  };
  frames: TrustedFrame[];
  limitations: string[];
}

// One coarse extraction. windowHonored is false only when a sourceWindow
// was asked for and an older extract-frames ignored it (frames unusable).
interface CoarseExtract {
  frames: ExtractedFrame[];
  coordinateScale: unknown;
  windowHonored: boolean;
}

const KEEP_BODY_METRICS = new Set([
  "spine_lean_degrees",
  "left_elbow_angle_degrees",
  "right_elbow_angle_degrees",
  "left_knee_angle_degrees",
  "right_knee_angle_degrees",
  "shoulder_tilt_ratio",
  "hip_tilt_ratio",
  "normalized_wrist_y",
  "wrist_vertical_velocity_normalized_per_frame",
  "metrics_unavailable",
]);

function filterRoboflowFrame(frameIndex: number, timestampSeconds: number, output: Record<string, unknown>, coordinateScale: unknown): TrustedFrame {
  const rawKeypoints = (output.body_keypoints as Record<string, Record<string, unknown>>) ?? {};
  const keypoints: TrustedFrame["keypoints"] = {};
  for (const [name, kp] of Object.entries(rawKeypoints)) {
    if (kp.metric_reliable === true && kp.available !== false && typeof kp.x === "number" && typeof kp.y === "number") {
      keypoints[name] = { x: kp.x as number, y: kp.y as number, confidence: (kp.confidence as number) ?? 0 };
    }
  }
  const rawMetrics = (output.body_metrics as Record<string, unknown>) ?? {};
  const bodyMetrics: Record<string, unknown> = {};
  for (const key of KEEP_BODY_METRICS) {
    if (rawMetrics[key] !== undefined) bodyMetrics[key] = rawMetrics[key];
  }
  return {
    frame_index: frameIndex,
    timestamp_seconds: timestampSeconds,
    person_confidence: typeof rawMetrics.person_confidence === "number" ? (rawMetrics.person_confidence as number) : null,
    // Back to the source video's pixel space when extract-frames sent a
    // downscaled frame (body_metrics are angles/ratios: scale-free).
    keypoints: scaleKeypoints(keypoints, coordinateScale),
    body_metrics: bodyMetrics,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Carries the provider's HTTP status so retry/back-off and failure codes
// can tell "busy, try later" (429/5xx) from a hard error.
class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  // providerErrorHint() of the body — allow-listed tokens only.
  readonly hint: string;
  constructor(status: number, hint: string, retryAfter: string | null) {
    super(`HTTP ${status}: ${hint}`);
    this.status = status;
    this.retryAfter = retryAfter;
    this.hint = hint;
  }
}

// A classified failure of one pipeline step, thrown by the step bodies and
// handled by runStep() (retry or give up) and the pipeline (fail()).
class StepError extends Error {
  readonly failure: StepFailure;
  readonly retryAfter: string | null;
  // How many times the step ran before giving up (for diagnostics).
  stepAttempts = 1;
  // timeout / aborted / network / http / invalid_output / internal — logs
  // and diagnostics only (the stored category is unchanged).
  kind: RequestFailureKind;
  constructor(failure: StepFailure, retryAfter: string | null = null, kind?: RequestFailureKind) {
    super(`${failure.category}@${failure.stage}`);
    this.name = "StepError";
    this.failure = failure;
    this.retryAfter = retryAfter;
    this.kind = kind ?? requestFailureKind(null, failure.httpStatus, failure.category);
  }
}

function httpStepError(stage: CaddieStage, status: number, body: string, headers?: Headers): StepError {
  const hint = providerErrorHint(body);
  // Vercel's own platform errors (timeout, payload too large) name
  // themselves in this header; it's an uppercase token, safe to keep.
  const vercelError = headers?.get("x-vercel-error") ?? "";
  const safeVercel = /^[A-Z_]{3,64}$/.test(vercelError) ? vercelError : "";
  const { category, retryable } = classifyHttpFailure(stage, status, hint);
  const detail = [`HTTP ${status}`, hint, safeVercel].filter(Boolean).join(" ");
  return new StepError({ stage, category, retryable, httpStatus: status, detail }, headers?.get("retry-after") ?? null);
}

function thrownStepError(stage: CaddieStage, err: unknown): StepError {
  if (err instanceof StepError) return err;
  const { category, retryable } = classifyThrown(stage, err);
  const kind = requestFailureKind(err);
  return new StepError({ stage, category, retryable, detail: `threw ${safeErrorName(err)} (${kind})` }, null, kind);
}

function hardFailure(stage: CaddieStage, category: StepFailure["category"], detail: string): StepError {
  return new StepError({ stage, category, retryable: false, detail });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Kill switch: set the CADDIE_DISABLED=1 Edge Function secret to stop all
  // new analyses (provider outage, runaway cost) without a deploy. Returns
  // before auth, any row insert, or any vendor call; `code` lets the client
  // show "Caddie is busy" copy and clean up the files it just uploaded
  // (no row exists to reference them).
  // CADDIE_DISABLED=unavailable is the longer-outage variant (e.g. Gemini
  // credits ran out): "temporarily unavailable" copy instead of "try again
  // in a minute", and no Roboflow credits are spent on runs that can only
  // fail at Gemini. Neither uses an allowance slot (no row is created).
  const disabled = (Deno.env.get("CADDIE_DISABLED") ?? "").trim().toLowerCase();
  if (disabled === "unavailable") {
    return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again.", code: "unavailable" }, 503);
  }
  if (disabled === "1" || disabled === "true") {
    return jsonResponse({ error: "Caddie is busy right now. Please try again in a minute.", code: "provider_busy" }, 503);
  }

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const roboflowApiKey = Deno.env.get("ROBOFLOW_API_KEY");
  const frameExtractSecret = Deno.env.get("FRAME_EXTRACT_SECRET");
  if (!geminiApiKey || !roboflowApiKey || !frameExtractSecret) {
    console.error("[analyze-swing] a required secret is not configured.", {
      geminiApiKey: !!geminiApiKey,
      roboflowApiKey: !!roboflowApiKey,
      frameExtractSecret: !!frameExtractSecret,
    });
    return jsonResponse({ error: "Caddie isn't configured yet. Please try again later." }, 500);
  }
  // Server-only HMAC key for Try-again pose checkpoints (never sent anywhere).
  const checkpointSecret: string = frameExtractSecret;
  // Gemini auth travels in this header on every call, never in a URL.
  const geminiAuth: Record<string, string> = { "x-goog-api-key": geminiApiKey };
  // Sampled latency experiment, OFF unless Micky sets the secret: the
  // fraction (0..1) of attempts whose generateContent asks for
  // thinkingLevel "low" (_shared/caddiePreprocessing.ts thinkingArmFor).
  const thinkingLowSample = parseSampleRate(Deno.env.get("CADDIE_THINKING_LOW_SAMPLE"));
  // Parallel trim + frame extraction from the original's window, for
  // originals up to this many MB. OFF (0) unless the secret is set: on
  // fixtures it saved no measurable CPU time (H.264 1.18 -> 1.04 s, HEVC
  // 1.29 -> 1.36 s locally), it downloads the original a second time, and
  // freezedetect can pick a slightly different active window on the noisier
  // original than on the re-encoded copy. Turn on only if production
  // frames_extracted extract_ms shows extraction is cold-start/transfer
  // bound (scratchpad trim-bench/).
  const parallelExtractMaxBytes = Math.max(0, Number(Deno.env.get("CADDIE_PARALLEL_EXTRACT_MAX_MB") ?? "0") || 0) * 1_000_000;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Not authenticated.", code: "not_authenticated" }, 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body.", code: "bad_request" }, 400);
  }

  // Dead jobs first: any of this caller's own rows still 'processing' well
  // past the deadline lost their worker (memory/CPU/platform kill) before it
  // could write an outcome. The database marks them failed/worker_lost,
  // keeping the last persisted stage, so they're retryable and countable.
  // Owner-scoped (invoker RPC + RLS). Best-effort.
  {
    const { error: sweepError } = await supabase.rpc("sweep_stale_caddie_jobs");
    if (sweepError) console.error("[analyze-swing] stale-job sweep failed.", redactDetail(sweepError.message, 160));
  }

  const locale = body.locale && SUPPORTED_LOCALES.has(body.locale) ? body.locale : "en";

  // Resolve WHICH media this analysis uses, server-side (P2-9 + private
  // bucket). Exactly one of mediaPath (private caddie-media) / mediaUrl
  // (public community-media) is set; thumbnails are best-effort (invalid =
  // dropped, never an error).
  let mediaPath: string | null = null;
  let mediaUrl: string | null = null;
  let thumbPath: string | null = null;
  let thumbUrl: string | null = null;
  let trimWindow: TrimWindow | undefined;
  let pipelineVideoUrl: string;
  let row: CaddieAnalysisRow;

  if (typeof body.retryAnalysisId === "string") {
    // ---- Try again: re-run the SAME row (no new record, no allowance
    // charge — only a delivered analysis is ever charged). ----
    if (!UUID_RE.test(body.retryAnalysisId)) return jsonResponse({ error: "Invalid request body.", code: "bad_request" }, 400);
    const { data: existing, error: existingError } = await supabase.from("caddie_analyses").select("*").eq("id", body.retryAnalysisId).maybeSingle();
    if (existingError) {
      console.error("[analyze-swing] retry lookup failed.", redactDetail(existingError.message, 160));
      return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again.", code: "unavailable" }, 500);
    }
    if (!existing) return jsonResponse({ error: "Analysis not found.", code: "not_found" }, 404);
    const current = existing as CaddieAnalysisRow;
    const startedAtMs = new Date(current.attempt_started_at ?? current.created_at).getTime();
    const staleProcessing = current.status === "processing" && Date.now() - startedAtMs > STALE_PROCESSING_MS;
    // Idempotent: a double tap, a second device, or a retry of a job that
    // already finished gets the row as it is now.
    if (current.status === "complete" || (current.status === "processing" && !staleProcessing)) {
      return jsonResponse({ analysis: current }, 200);
    }
    if (current.status !== "failed" && !staleProcessing) return jsonResponse({ error: "This swing video can't be analyzed.", code: "cant_analyze" }, 400);
    if (current.attempt >= MAX_ATTEMPTS) {
      return jsonResponse({ error: "Caddie has tried this swing several times. Please film a new clip.", code: "retry_cap" }, 429);
    }
    mediaPath = current.source_media_path ? ownCaddiePath(current.source_media_path, user.id) : null;
    mediaUrl = !mediaPath && current.source_media_url ? ownPublicCommunityMediaUrl(current.source_media_url, user.id, supabaseUrl) : null;
    if (!mediaPath && !mediaUrl) return jsonResponse({ error: "This swing video can't be analyzed.", code: "cant_analyze" }, 400);
    trimWindow = rowTrimWindow(current);

    // Signed BEFORE the flip, so a missing object never burns an attempt.
    let signedUrl = mediaUrl;
    if (mediaPath) {
      const { data: signed, error: signError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).createSignedUrl(mediaPath, PIPELINE_SIGNED_URL_SECONDS);
      if (signError || !signed?.signedUrl) return jsonResponse({ error: "This swing video can't be analyzed.", code: "cant_analyze" }, 400);
      signedUrl = signed.signedUrl;
    }
    pipelineVideoUrl = signedUrl!;

    // The atomic flip: conditional on the attempt we read, so of two
    // concurrent Try agains exactly one wins (the row lock serializes them;
    // the loser's WHERE no longer matches). The database's guard trigger
    // (20261107140000) re-checks failed-or-stale, the 3-retry cap, the
    // allowance and the 60-run ceiling, and stamps attempt_started_at.
    const { data: flipped, error: flipError } = await supabase
      .from("caddie_analyses")
      .update({
        status: "processing",
        attempt: current.attempt + 1,
        stage: "media_fetch",
        stage_updated_at: new Date().toISOString(),
        failure_stage: null,
        failure_category: null,
        failure_retryable: null,
        provider_http_status: null,
        error_message: null,
        ...(trimWindow ? { trim_start_seconds: trimWindow.startSeconds, trim_end_seconds: trimWindow.endSeconds } : {}),
      })
      .eq("id", current.id)
      .eq("attempt", current.attempt)
      .in("status", ["failed", "processing"])
      .select()
      .maybeSingle();
    if (flipError) {
      const refusal = flipError.hint ? TRIGGER_REFUSALS[flipError.hint] : undefined;
      if (refusal) return jsonResponse({ error: flipError.message, code: refusal.code }, refusal.status);
      console.error("[analyze-swing] retry flip failed.", redactDetail(flipError.message, 160));
      return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again.", code: "unavailable" }, 500);
    }
    if (!flipped) {
      // Lost the race to another Try again: hand back whatever is there now.
      const { data: latest } = await supabase.from("caddie_analyses").select("*").eq("id", current.id).maybeSingle();
      return jsonResponse({ analysis: latest ?? current }, 200);
    }
    row = flipped as CaddieAnalysisRow;
  } else {
  if (body.sourceType !== "direct_upload" && body.sourceType !== "community_post") {
    return jsonResponse({ error: "Invalid sourceType.", code: "bad_request" }, 400);
  }
  if (body.sourceType === "community_post" && !body.sourcePostId) {
    return jsonResponse({ error: "sourcePostId is required for a community_post analysis.", code: "bad_request" }, 400);
  }

  if (body.sourceType === "community_post") {
    // The post's own media, never the client's copy of it. Same messages as
    // the ownership trigger (20260817091500), which still runs on insert.
    const { data: post } = await supabase
      .from("community_posts")
      .select("author_id, video_url, video_thumbnail_url")
      .eq("id", body.sourcePostId!)
      .maybeSingle();
    if (!post) return jsonResponse({ error: "Source post not found.", code: "forbidden" }, 403);
    if (post.author_id !== user.id) return jsonResponse({ error: "Ask Caddie is only available on your own posts.", code: "forbidden" }, 403);
    mediaUrl = ownPublicCommunityMediaUrl(post.video_url, user.id, supabaseUrl);
    thumbUrl = ownPublicCommunityMediaUrl(post.video_thumbnail_url, user.id, supabaseUrl);
  } else if (body.sourceMediaPath !== undefined) {
    mediaPath = ownCaddiePath(body.sourceMediaPath, user.id);
    thumbPath = ownCaddiePath(body.thumbnailPath, user.id);
  } else {
    mediaUrl = ownPublicCommunityMediaUrl(body.sourceMediaUrl, user.id, supabaseUrl);
    thumbUrl = ownPublicCommunityMediaUrl(body.thumbnailUrl, user.id, supabaseUrl);
  }
  if (!mediaPath && !mediaUrl) return jsonResponse({ error: "This swing video can't be analyzed.", code: "cant_analyze" }, 400);

  // A private object is signed now, with the caller's JWT: caddie-media's
  // owner-only RLS makes this fail for a path that doesn't exist or isn't
  // theirs — before any row (and daily-limit slot) is spent. The pipeline
  // reuses this URL for every fetch; nothing about it is ever stored.
  let signedUrl = mediaUrl;
  if (mediaPath) {
    const { data: signed, error: signError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).createSignedUrl(mediaPath, PIPELINE_SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) return jsonResponse({ error: "This swing video can't be analyzed.", code: "cant_analyze" }, 400);
    signedUrl = signed.signedUrl;
  }
  pipelineVideoUrl = signedUrl!;

  // A trimmed window from VideoTrimSelector, re-validated server-side
  // rather than trusted from the client — malformed/out-of-range values
  // are silently ignored (falls back to analyzing the whole source video)
  // rather than failing the request over what's just a cost-control input,
  // not a correctness one.
  const clientWindow =
    typeof body.startSeconds === "number" && typeof body.endSeconds === "number" && Number.isFinite(body.startSeconds) && body.endSeconds > body.startSeconds
      ? { startSeconds: Math.max(0, Math.round(body.startSeconds * 1000) / 1000), endSeconds: Math.round(body.endSeconds * 1000) / 1000 }
      : undefined;
  trimWindow =
    clientWindow && clientWindow.endSeconds - clientWindow.startSeconds <= MAX_TRIM_WINDOW_SECONDS + 0.5 ? clientWindow : undefined;

  // Rate limiting — scoped to this user's own rows only, RLS does that for
  // free since `supabase` here carries the caller's JWT, not service role.
  const { data: recentRows, error: recentError } = await supabase
    .from("caddie_analyses")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (recentError) {
    console.error("[analyze-swing] rate-limit lookup failed.", redactDetail(recentError.message, 160));
    return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again.", code: "unavailable" }, 500);
  }
  const lastRequestAt = recentRows?.[0]?.created_at ? new Date(recentRows[0].created_at).getTime() : 0;
  if (lastRequestAt && Date.now() - lastRequestAt < COOLDOWN_SECONDS * 1000) {
    return jsonResponse({ error: "Please wait a moment before asking Caddie again.", code: "cooldown" }, 429);
  }

  // Friendly pre-check of the allowance (delivered analyses + live jobs) and
  // the hidden run ceiling. The insert trigger is the authoritative,
  // race-proof check; if this RPC isn't available it is simply skipped.
  const { data: allowanceRows, error: allowanceError } = await supabase.rpc("caddie_allowance_status");
  if (allowanceError) {
    console.error("[analyze-swing] allowance lookup failed (insert trigger still enforces).", redactDetail(allowanceError.message, 160));
  } else {
    const allowance = (Array.isArray(allowanceRows) ? allowanceRows[0] : allowanceRows) as
      | { used: number; daily_limit: number; starts: number; start_ceiling: number }
      | undefined;
    if (allowance && allowance.used >= allowance.daily_limit) {
      return jsonResponse({ error: `You've reached today's Caddie analysis limit (${DAILY_LIMIT_PER_USER}). Try again tomorrow.`, code: "daily_limit" }, 429);
    }
    if (allowance && allowance.starts >= allowance.start_ceiling) {
      return jsonResponse({ error: "Caddie has had a lot of attempts today. Please try again tomorrow.", code: "attempt_ceiling" }, 429);
    }
  }

  // Duplicate-tap protection: an active (recent, still-processing) request
  // for the exact same source already exists — hand that back instead of
  // starting a second Roboflow+Gemini run. A stale 'processing' row
  // (crashed mid-request, never reached the update step) doesn't count —
  // it must not permanently block retries.
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  let inFlightQuery = supabase.from("caddie_analyses").select("*").eq("status", "processing").gte("attempt_started_at", staleCutoff);
  inFlightQuery =
    body.sourceType === "community_post"
      ? inFlightQuery.eq("source_post_id", body.sourcePostId!)
      : mediaPath
        ? inFlightQuery.eq("source_type", "direct_upload").eq("source_media_path", mediaPath)
        : inFlightQuery.eq("source_type", "direct_upload").eq("source_media_url", mediaUrl!);
  const { data: inFlightRows } = await inFlightQuery.limit(1);
  if (inFlightRows && inFlightRows.length > 0) {
    devLog("duplicate request, returning existing in-flight row", { id: inFlightRows[0].id });
    return jsonResponse({ analysis: inFlightRows[0] }, 200);
  }

  // Idempotency: reuse an already-COMPLETE analysis for the exact same
  // source instead of re-spending Roboflow+Gemini credits on a rerun. The
  // client's own community_post UI already avoids re-triggering this (it
  // shows "View Analysis" once one exists), but this is a server-side
  // backstop against any other path — e.g. re-selecting the identical
  // file on the direct-upload screen — burning credits pointlessly on a
  // swing Caddie has already analyzed.
  let completedQuery = supabase.from("caddie_analyses").select("*").eq("status", "complete").order("created_at", { ascending: false });
  completedQuery =
    body.sourceType === "community_post"
      ? completedQuery.eq("source_post_id", body.sourcePostId!)
      : mediaPath
        ? completedQuery.eq("source_type", "direct_upload").eq("source_media_path", mediaPath)
        : completedQuery.eq("source_type", "direct_upload").eq("source_media_url", mediaUrl!);
  const { data: completedRows } = await completedQuery.limit(1);
  if (completedRows && completedRows.length > 0) {
    devLog("already-complete analysis exists, reusing", { id: completedRows[0].id });
    return jsonResponse({ analysis: completedRows[0] }, 200);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("caddie_analyses")
    .insert({
      owner_id: user.id,
      source_type: body.sourceType,
      source_post_id: body.sourceType === "community_post" ? body.sourcePostId : null,
      source_media_url: mediaUrl,
      source_media_path: mediaPath,
      thumbnail_url: thumbUrl,
      thumbnail_path: thumbPath,
      swing_type: body.swingType ?? null,
      status: "processing",
      stage: "media_fetch",
      stage_updated_at: new Date().toISOString(),
      ...(trimWindow ? { trim_start_seconds: trimWindow.startSeconds, trim_end_seconds: trimWindow.endSeconds } : {}),
    })
    .select()
    .single();
  if (insertError || !inserted) {
    // The ownership trigger (20260817091500) raises exactly this kind of
    // message for a community_post the caller doesn't own — safe to
    // forward verbatim, it was written to be client-facing.
    // The allowance/ceiling trigger (20261107140000) is the race-proof
    // backstop for the pre-check above — concurrent requests that all passed
    // it land here, identified by the error's hint.
    const message = insertError?.message ?? "Could not start this analysis.";
    const refusal = insertError?.hint ? TRIGGER_REFUSALS[insertError.hint] : undefined;
    if (refusal) return jsonResponse({ error: message, code: refusal.code }, refusal.status);
    if (message.includes("only available on your own posts") || message.includes("Source post not found")) {
      return jsonResponse({ error: message, code: "forbidden" }, 403);
    }
    console.error("[analyze-swing] insert failed.", redactDetail(message, 160));
    return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again.", code: "unavailable" }, 500);
  }
  row = inserted as CaddieAnalysisRow;
  }

  const attempt = row.attempt ?? 1;
  // Per attempt, re-derivable from row id + attempt; logged on gemini_try /
  // complete and stored as analysis_json.thinking_level for comparison.
  const thinkingArm: ThinkingArm = await thinkingArmFor(row.id, attempt, thinkingLowSample);
  const pipelineStart = Date.now();

  // Set once the pipeline has reached a terminal state (complete, failed,
  // or timed out) so a run that keeps going after the deadline can't write
  // a second outcome. Every DB write is also conditional on
  // status = 'processing' AND attempt = this attempt, the real guard: an
  // older attempt that wakes up late can never overwrite a newer one.
  let settled = false;
  // The trimmed private copy, once uploaded; removed again on failure.
  let trimmedPath: string | null = null;
  let currentStage: CaddieStage = "media_fetch";

  // Aborted the moment this attempt reaches a terminal state (fail(), the
  // deadline, or the save). Every provider/route fetch listens to it as
  // well as to its own timeout, so a request still open when the attempt
  // ends is cancelled — its socket and the worker's memory are released —
  // instead of running on in the background (job 5f4c8655: attempt 1's
  // second generateContent was still open when its deadline fired).
  const pipelineAbort = new AbortController();
  function requestSignal(timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (typeof AbortSignal.any === "function") return AbortSignal.any([pipelineAbort.signal, timeout]);
    // Older runtimes without AbortSignal.any: forward both by hand.
    const both = new AbortController();
    const forward = (s: AbortSignal) => () => both.abort(s.reason);
    if (pipelineAbort.signal.aborted) both.abort(pipelineAbort.signal.reason);
    pipelineAbort.signal.addEventListener("abort", forward(pipelineAbort.signal), { once: true });
    timeout.addEventListener("abort", forward(timeout), { once: true });
    return both.signal;
  }
  function settle(): void {
    settled = true;
    if (!pipelineAbort.signal.aborted) pipelineAbort.abort(new DOMException("attempt settled", "AbortError"));
  }

  // One structured, always-on log line per event: job id, attempt, stage,
  // timing and classified outcome only — never a URL, body or message.
  function logEvent(evt: string, fields: Record<string, unknown> = {}, level: "log" | "error" = "log") {
    const line = JSON.stringify({ fn: "analyze-swing", evt, job: row.id, attempt, ms: Date.now() - pipelineStart, ...fields });
    if (level === "error") console.error(line);
    else console.log(line);
  }

  // Persisted (coarse) stages, so a killed worker still says where it died.
  const PERSISTED_STAGES = new Set<CaddieStage>(["trim", "frame_extract", "pose", "gemini_upload", "gemini_generate"]);
  async function enterStage(stage: CaddieStage): Promise<void> {
    if (settled) return;
    currentStage = stage;
    logEvent("stage", { stage });
    if (!PERSISTED_STAGES.has(stage)) return;
    const { error } = await supabase
      .from("caddie_analyses")
      .update({ stage, stage_updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "processing")
      .eq("attempt", attempt);
    if (error) logEvent("stage_write_failed", { stage }, "error");
  }

  // error_message keeps the legacy `code:<code> [window:..]` prefix for older
  // app builds, followed by `<category>@<stage>` — no free text. The
  // classified columns carry the structure; the redacted detail goes to
  // private.caddie_job_diagnostics only (admin-readable).
  async function fail(failure: StepFailure, stepAttempts = 1, kind?: RequestFailureKind): Promise<void> {
    if (settled) return;
    settle();
    const detail = redactDetail(failure.detail, 300);
    logEvent(
      "failed",
      {
        stage: failure.stage,
        category: failure.category,
        kind: kind ?? requestFailureKind(null, failure.httpStatus, failure.category),
        retryable: failure.retryable,
        http_status: failure.httpStatus ?? null,
        step_attempts: stepAttempts,
        remaining_ms: PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart),
      },
      "error",
    );
    // Marked failed, not deleted — see the header comment above. Scoped to
    // THIS attempt while it is still processing; `select` tells us whether
    // it matched. When it didn't (a newer attempt owns the row, or this
    // attempt's save landed first), this attempt no longer owns the row:
    // no diagnostic, and above all no file removal (the trimmed copy may
    // be what a completed row now points at).
    const { data: failedRows, error: failUpdateError } = await supabase
      .from("caddie_analyses")
      .update({
        status: "failed",
        error_message: formatStructuredFailure(failure, trimWindow),
        stage: failure.stage,
        stage_updated_at: new Date().toISOString(),
        failure_stage: failure.stage,
        failure_category: failure.category,
        failure_retryable: failure.retryable,
        provider_http_status: failure.httpStatus ?? null,
      })
      .eq("id", row.id)
      .eq("status", "processing")
      .eq("attempt", attempt)
      .select("id");
    if (failUpdateError) {
      // Unknown whether it landed; the stale sweep (390 s) is the backstop.
      console.error("[analyze-swing] failed to mark row as failed.", { rowId: row.id, reason: redactDetail(failUpdateError.message, 160) });
    } else if (!failedRows || failedRows.length === 0) {
      logEvent("failure_discarded", { reason: "row no longer processing for this attempt" });
      return;
    }
    const { error: diagError } = await supabase.rpc("record_caddie_diagnostic", {
      p_analysis_id: row.id,
      p_attempt: attempt,
      p_stage: failure.stage,
      p_category: failure.category,
      p_retryable: failure.retryable,
      p_http_status: failure.httpStatus ?? null,
      p_step_attempts: stepAttempts,
      p_detail: detail,
    });
    if (diagError) logEvent("diagnostic_write_failed", {}, "error");
    // The failed row still points at the untrimmed original (Try again
    // re-trims it from the row's trim window), so this attempt's trimmed
    // copy is unreferenced. Best-effort.
    if (trimmedPath) {
      const { error: removeError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).remove([trimmedPath]);
      if (removeError) console.error("[analyze-swing] couldn't remove the trimmed copy of a failed run.", { rowId: row.id, reason: redactDetail(removeError.message, 160) });
    }
  }

  // Runs one pipeline step, re-running it up to 2 more times with back-off
  // for transient failures only (stepRetryDelayMs), while the deadline
  // allows. Same row, same attempt: a step retry never creates a record.
  async function runStep<T>(stage: CaddieStage, fn: (stepAttempt: number) => Promise<T>): Promise<T> {
    for (let stepAttempt = 1; ; stepAttempt++) {
      if (settled) throw new StepError({ stage, category: "deadline_exceeded", retryable: true, detail: "settled" }, null, "aborted");
      try {
        const value = await fn(stepAttempt);
        if (stepAttempt > 1) logEvent("step_recovered", { stage, step_attempt: stepAttempt });
        return value;
      } catch (err) {
        const stepError = thrownStepError(stage, err);
        stepError.stepAttempts = stepAttempt;
        const remainingMs = PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart);
        const delay = settled ? null : stepRetryDelayMs(stepError.failure, stepAttempt, remainingMs, STEP_BUDGET_MS[stage], stepError.retryAfter);
        const fields = {
          stage: stepError.failure.stage,
          category: stepError.failure.category,
          kind: stepError.kind,
          http_status: stepError.failure.httpStatus ?? null,
          step_attempt: stepAttempt,
          remaining_ms: remainingMs,
          ...(stage.startsWith("gemini") || stage === "output_validation" ? { model: GEMINI_MODEL } : {}),
        };
        if (delay === null) {
          if (!settled) logEvent("step_gave_up", fields, "error");
          throw stepError;
        }
        logEvent("step_retry", { ...fields, delay_ms: delay, ...(lastRequestTimeoutMs.has(stage) ? { request_timeout_ms: lastRequestTimeoutMs.get(stage) } : {}) });
        await sleep(delay);
      }
    }
  }
  // The timeout the most recent try of a step ran with, for step_retry's
  // telemetry (only the steps that set one: gemini_generate).
  const lastRequestTimeoutMs = new Map<CaddieStage, number>();

  // ---- Everything from here runs AFTER the response below is already
  // sent — this request can't stay open for the full pipeline. The client
  // already has the 'processing' row via the response and via realtime. ----
  // Any thrown StepError (or unexpected throw) ends the attempt via fail();
  // a throw after the deadline already settled the row is ignored.
  async function runPipeline(): Promise<void> {
    try {
      await pipelineBody();
    } catch (err) {
      if (settled) return;
      const stepError = err instanceof StepError ? err : new StepError({ stage: currentStage, category: "internal", retryable: false, detail: `threw ${safeErrorName(err)}` });
      await fail(stepError.failure, stepError.stepAttempts, stepError.kind);
    }
  }

  async function pipelineBody(): Promise<void> {
    // The video bytes Gemini gets, and the URL frame extraction reads: the
    // signed caddie-media URL made above for a private upload, or the
    // validated public community-media URL. This function never makes a
    // private video public to satisfy Gemini.
    let videoBytes: ArrayBuffer;
    let videoContentType = "video/mp4";
    let effectiveVideoUrl = pipelineVideoUrl;

    // --- Try again: reuse the earlier attempt's pose work when it matches
    // (migration 20261108160000, _shared/caddiePreprocessing.ts). The video
    // is still fetched/trimmed below (Gemini needs it, and the row's video
    // becomes this attempt's trimmed copy); frame extraction and every
    // Roboflow call are skipped.
    const preprocessingSourceKey = await sourceKey(mediaPath ?? mediaUrl ?? pipelineVideoUrl);
    let reusedPose: TrustedPoseData | null = null;
    if (attempt > 1) {
      const { data: stored, error: storedError } = await supabase.rpc("get_caddie_preprocessing", { p_analysis_id: row.id });
      const storedRow = Array.isArray(stored) ? stored[0] : stored;
      const verdict = storedError
        ? "unavailable"
        : await checkpointVerdict(
            checkpointSecret,
            storedRow
              ? {
                  analysisId: storedRow.analysis_id,
                  attempt: storedRow.attempt,
                  sourceKey: storedRow.source_key,
                  trimStartSeconds: storedRow.trim_start_seconds === null ? null : Number(storedRow.trim_start_seconds),
                  trimEndSeconds: storedRow.trim_end_seconds === null ? null : Number(storedRow.trim_end_seconds),
                  pipelineVersion: storedRow.pipeline_version,
                  pose: storedRow.pose,
                  sig: storedRow.sig,
                  createdAt: storedRow.created_at,
                }
              : null,
            { analysisId: row.id, sourceKey: preprocessingSourceKey, window: trimWindow, version: PREPROCESSING_VERSION },
          );
      if (verdict === "reuse") reusedPose = storedRow.pose as TrustedPoseData;
      logEvent("preprocessing_reuse", { verdict, from_attempt: storedRow?.attempt ?? null });
    }

    // Optional (CADDIE_PARALLEL_EXTRACT_MAX_MB, off by default): with a trim
    // window and a small original, coarse frames are extracted from the
    // ORIGINAL's window (extract-frames `sourceWindow`) at the same time as
    // the trim instead of after it (same timeline and frame size as the
    // trimmed copy, tests/extractSourceWindow.test.ts). An older
    // extract-frames that doesn't echo the window is detected below and the
    // frames are re-extracted from the trimmed copy, as before.
    let earlyExtract: Promise<CoarseExtract | null> | null = null;
    // The original's size from a 1-byte range read (Content-Range total),
    // or null when the store doesn't say (then: no parallel extraction).
    async function originalSizeBytes(): Promise<number | null> {
      try {
        const res = await fetch(pipelineVideoUrl, { headers: { Range: "bytes=0-0" }, signal: requestSignal(TIMEOUT_MS.sizeProbe) });
        const total = res.headers.get("content-range")?.match(/\/(\d+)\s*$/)?.[1];
        await res.body?.cancel().catch(() => {});
        return res.status === 206 && total ? Number(total) : null;
      } catch {
        return null;
      }
    }

    if (!trimWindow) {
      await enterStage("media_fetch");
      const media = await runStep("media_fetch", async () => {
        const res = await fetch(pipelineVideoUrl, { signal: requestSignal(TIMEOUT_MS.media) });
        if (!res.ok) throw httpStepError("media_fetch", res.status, await res.text().catch(() => ""), res.headers);
        // Refuse to buffer something that would risk the worker's memory
        // limit (a silent kill) — fail it clearly instead.
        const declared = Number(res.headers.get("content-length") ?? NaN);
        if (Number.isFinite(declared) && declared > MAX_BUFFERED_VIDEO_BYTES) {
          await res.body?.cancel().catch(() => {});
          throw hardFailure("media_fetch", "video_too_long_or_large", `content-length ${declared}`);
        }
        return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "video/mp4" };
      });
      if (media.bytes.byteLength === 0) throw hardFailure("media_fetch", "video_unreadable", "0 bytes");
      if (media.bytes.byteLength > Math.min(MAX_VIDEO_BYTES, MAX_BUFFERED_VIDEO_BYTES)) {
        throw hardFailure("media_fetch", "video_too_long_or_large", `${media.bytes.byteLength} bytes`);
      }
      videoBytes = media.bytes;
      videoContentType = media.contentType;
      logEvent("video_fetched", { bytes: videoBytes.byteLength, content_type: /^[a-z0-9.+/-]{1,64}$/i.test(videoContentType) ? videoContentType : "other" });
    } else {
      // The golfer picked a window (VideoTrimSelector): trim server-side and
      // re-upload the result (private caddie-media) as this row's real video
      // — NOT just a sampling-window hint (that left the untrimmed original
      // as the row's video: "the crop isn't applied"). trim-video fetches the
      // original itself, so the original is never buffered in this worker;
      // only the (small, re-encoded) trimmed copy is.
      await enterStage("trim");
      const window = trimWindow;
      if (!reusedPose && parallelExtractMaxBytes > 0) {
        // Only for an original small enough that a second full download
        // (extract-frames fetches it too) costs less than waiting for the
        // trim. A window picked from a LONG recording (tens to hundreds of
        // MB) keeps the old order: extract from the small trimmed copy.
        earlyExtract = originalSizeBytes().then((size) => {
          const parallel = size !== null && size <= parallelExtractMaxBytes;
          logEvent("frames_source", { original_bytes: size, parallel });
          return parallel ? extractCoarseFrames(FRAME_MAX_LONG_SIDE, { sourceWindow: window }) : null;
        });
        // Settled by the await below; until then a rejection (or an abort
        // after a failed trim) must not surface as an unhandled one.
        earlyExtract.catch(() => {});
      }
      const trimmedBytes = await runStep("trim", async () => {
        const res = await fetch(TRIM_VIDEO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${frameExtractSecret}` },
          body: JSON.stringify({ videoUrl: pipelineVideoUrl, startSeconds: window.startSeconds, endSeconds: window.endSeconds }),
          signal: requestSignal(TIMEOUT_MS.trim),
        });
        if (!res.ok) throw httpStepError("trim", res.status, await res.text().catch(() => ""), res.headers);
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength === 0) throw new StepError({ stage: "trim", category: "provider_unavailable", retryable: true, detail: "0 bytes" });
        return bytes;
      });
      if (trimmedBytes.byteLength > MAX_BUFFERED_VIDEO_BYTES) {
        throw hardFailure("trim", "video_too_long_or_large", `trimmed ${trimmedBytes.byteLength} bytes`);
      }

      // Per-attempt name: a Try again on this same row must never collide
      // with an earlier attempt's copy (the bucket has no update policy, so
      // an upsert isn't possible).
      const newTrimmedPath = `${row.owner_id}/caddie-trimmed-${row.id}-a${attempt}.mp4`;
      await runStep("trim", async () => {
        const { error } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).upload(newTrimmedPath, trimmedBytes, { contentType: "video/mp4" });
        // A previous try of THIS step may have landed before its response was lost.
        if (error && !/already exists|duplicate/i.test(error.message)) {
          throw new StepError({ stage: "trim", category: "provider_unavailable", retryable: true, detail: `storage upload ${redactDetail(error.message, 80)}` });
        }
      });
      trimmedPath = newTrimmedPath;
      const trimmedSignedUrl = await runStep("trim", async () => {
        const { data, error } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).createSignedUrl(newTrimmedPath, PIPELINE_SIGNED_URL_SECONDS);
        if (error || !data?.signedUrl) throw new StepError({ stage: "trim", category: "provider_unavailable", retryable: true, detail: "storage sign" });
        return data.signedUrl;
      });
      effectiveVideoUrl = trimmedSignedUrl;
      videoBytes = trimmedBytes;
      videoContentType = "video/mp4";
      logEvent("video_trimmed", { bytes: videoBytes.byteLength });
    }

    // --- Frame extraction (Vercel/Node — see api/extract-frames.ts). ---
    // A function because the pose gate's full-resolution safety net (below)
    // runs it a second time with a larger long side.
    async function extractCoarseFrames(maxLongSide: number, opts: { sourceWindow?: TrimWindow } = {}): Promise<CoarseExtract> {
      const extractStart = Date.now();
      const extracted = await runStep("frame_extract", async () => {
        const res = await fetch(FRAME_EXTRACT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${frameExtractSecret}` },
          // Either the ORIGINAL plus the trim window (sourceWindow: read only
          // that window, timestamps relative to its start, in parallel with
          // the trim), or effectiveVideoUrl, which is already exactly the
          // analyzed window once trimmed. extract-frames' own freezedetect
          // auto-trim runs within the window either way, and on an
          // UNtrimmed video as before.
          body: JSON.stringify(
            opts.sourceWindow
              ? { videoUrl: pipelineVideoUrl, fps: ANALYSIS_FPS, maxLongSide, sourceWindow: opts.sourceWindow }
              : { videoUrl: effectiveVideoUrl, fps: ANALYSIS_FPS, maxLongSide },
          ),
          signal: requestSignal(TIMEOUT_MS.extract),
        });
        // 422 = ffmpeg couldn't decode it; 502 = it couldn't fetch the video;
        // 500 + token = resources/internal; 504 = the Vercel function timed out
        // (see classifyHttpFailure).
        if (!res.ok) throw httpStepError("frame_extract", res.status, await res.text().catch(() => ""), res.headers);
        return (await res.json()) as {
          coordinateScale?: unknown;
          analysisFps?: number;
          frames?: { frameIndex: number; timestampSeconds: number; base64: string }[];
          sourceWindow?: { startSeconds?: number; endSeconds?: number } | null;
        };
      });
      // An extract-frames build from before sourceWindow ignores it and
      // returns frames of the WHOLE original on the original's timeline:
      // never use those.
      const windowHonored =
        !opts.sourceWindow ||
        (extracted.sourceWindow?.startSeconds === opts.sourceWindow.startSeconds && typeof extracted.sourceWindow?.endSeconds === "number");
      if (!windowHonored) return { frames: [], coordinateScale: undefined, windowHonored: false };
      const extractedFrames: ExtractedFrame[] = (extracted.frames ?? []).map((f) => ({
        frameIndex: f.frameIndex,
        timestampSeconds: f.timestampSeconds,
        base64: f.base64,
      }));
      if (extractedFrames.length === 0) throw hardFailure("frame_extract", "video_unreadable", "0 frames");
      if (extractedFrames.length > MAX_ANALYSIS_FRAMES) {
        throw hardFailure("frame_extract", "video_too_long_or_large", `${extractedFrames.length} frames > cap ${MAX_ANALYSIS_FRAMES}`);
      }
      logEvent("frames_extracted", {
        count: extractedFrames.length,
        fps: extracted.analysisFps ?? null,
        max_long_side: maxLongSide,
        from: opts.sourceWindow ? "original_window" : "analyzed_video",
        extract_ms: Date.now() - extractStart,
      });
      return { frames: extractedFrames, coordinateScale: extracted.coordinateScale, windowHonored: true };
    }

    let trustedPoseData: TrustedPoseData;
    if (reusedPose) {
      trustedPoseData = reusedPose;
    } else {
      await enterStage("frame_extract");
      let firstExtract = (earlyExtract ? await earlyExtract : null) ?? (await extractCoarseFrames(FRAME_MAX_LONG_SIDE));
      if (!firstExtract.windowHonored) {
        logEvent("source_window_unsupported", {});
        firstExtract = await extractCoarseFrames(FRAME_MAX_LONG_SIDE);
      }
      // Multiply Roboflow keypoints by this to get source-video pixels
      // (undefined = frames weren't downscaled). Replaced, together with
      // frames, when the full-resolution safety net rescues the clip.
      let coordinateScale: unknown = firstExtract.coordinateScale;
      let frames: ExtractedFrame[] = firstExtract.frames;
      let frameLongSide = FRAME_MAX_LONG_SIDE;

      // --- Roboflow: one call per frame, stateless, moderate concurrency,
      // each frame retried once on failure before being given up on. ---
      // firstFailureDetail captures only the FIRST failure's cause (status
      // code + truncated body, or thrown error) — logging every one of
      // dozens of per-frame failures would be noise, but a total wipeout
      // (0/45, seen in production — that day it was Roboflow's own
      // credit_cap_exceeded) is otherwise a black box: was it auth, quota,
      // a malformed request, or Roboflow itself erroring? A quota/auth
      // error fails identically on every retry (not transient), so this
      // still surfaces that root cause immediately rather than masking it
      // behind two attempts per frame.
      let firstFailureDetail: string | undefined;
      // One gate for every Roboflow pass of this job (coarse, full-res, dense).
      const roboflowGate = new AdaptiveConcurrency(ROBOFLOW_CONCURRENCY, ROBOFLOW_MIN_CONCURRENCY);
      let roboflowRetryCount = 0;
      // scale: the coordinateScale of the extraction this frame came from.
      // tally: raw (pre-filter) counts for the pose gate's diagnostics; only
      // the coarse passes pass one.
      type RoboflowCallContext = { scale: unknown; tally?: PoseSignalTally };
      async function callRoboflowOnce(frame: ExtractedFrame, ctx: RoboflowCallContext): Promise<TrustedFrame | null> {
        const res = await fetch(ROBOFLOW_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: roboflowApiKey, inputs: { image: { type: "base64", value: frame.base64 } } }),
          signal: requestSignal(TIMEOUT_MS.roboflowFrame),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new ProviderHttpError(res.status, providerErrorHint(errBody), res.headers.get("retry-after"));
        }
        const body = await res.json();
        const output = body?.outputs?.[0];
        if (!output) throw new Error("no outputs[0] in response");
        if (ctx.tally) tallyRoboflowOutput(ctx.tally, output);
        return filterRoboflowFrame(frame.frameIndex, frame.timestampSeconds, output, ctx.scale);
      }
      // One frame, ROBOFLOW_FRAME_RETRY_ATTEMPTS total attempts. A 429 (rate
      // limit) or 5xx backs off before retrying — retrying a 429 immediately
      // from 8 parallel workers just gets rate-limited again.
      async function callRoboflowWithRetry(
        frame: ExtractedFrame,
        ctx: RoboflowCallContext,
        onRetry: () => void,
      ): Promise<{ frame: TrustedFrame | null; error?: unknown }> {
        let lastErr: unknown;
        for (let attempt = 1; attempt <= ROBOFLOW_FRAME_RETRY_ATTEMPTS; attempt++) {
          if (settled) return { frame: null, error: lastErr };
          try {
            return { frame: await callRoboflowOnce(frame, ctx) };
          } catch (err) {
            lastErr = err;
            // A hard 4xx (auth, credit cap, bad request) fails the same way
            // every time: don't spend a second call on it.
            const transient = !(err instanceof ProviderHttpError) || isRetryableStatus(err.status);
            // Rate limited: fewer frames in flight for the rest of this job.
            if (err instanceof ProviderHttpError && err.status === 429 && roboflowGate.onRateLimited()) {
              logEvent("roboflow_throttled", { concurrency: roboflowGate.limit });
            }
            if (attempt < ROBOFLOW_FRAME_RETRY_ATTEMPTS && transient) {
              onRetry();
              if (err instanceof ProviderHttpError) {
                await sleep(backoffMs(attempt, ROBOFLOW_BACKOFF_BASE_MS, ROBOFLOW_BACKOFF_CAP_MS, err.retryAfter));
              }
            } else {
              break;
            }
          }
        }
        return { frame: null, error: lastErr };
      }
      // The pass, plus up to 2 more passes over ONLY the frames that failed,
      // when the failures were transient (429/5xx/network) and the deadline
      // allows — same row, same attempt.
      // Returns null once the deadline has settled the row.
      async function runCoarsePosePass(passFrames: ExtractedFrame[], ctx: RoboflowCallContext): Promise<TrustedFrame[] | null> {
      const roboflowResults: (TrustedFrame | null)[] = new Array(passFrames.length).fill(null);
      for (let pass = 1; ; pass++) {
        let passError: unknown;
        const pending = passFrames.map((frame, index) => ({ frame, index })).filter(({ index }) => roboflowResults[index] === null);
        await mapWithAdaptiveConcurrency(pending, roboflowGate, async ({ frame, index }) => {
          const result = await callRoboflowWithRetry(frame, ctx, () => roboflowRetryCount++);
          if (result.frame) roboflowResults[index] = result.frame;
          else if (passError === undefined && result.error !== undefined) passError = result.error;
        });
        if (settled) return null;
        const succeeded = roboflowResults.filter((f) => f !== null).length;
        if (succeeded / passFrames.length >= ROBOFLOW_MIN_SUCCESS_RATIO) break;

        // ProviderHttpError carries the status + allow-listed hint; any other
        // throw (fetch/network/timeout) contributes its class name only.
        firstFailureDetail =
          passError instanceof ProviderHttpError ? passError.message : passError !== undefined ? `threw ${safeErrorName(passError)}` : "no error recorded";
        const classified =
          passError instanceof ProviderHttpError ? classifyHttpFailure("pose", passError.status, passError.hint) : classifyThrown("pose", passError);
        const failure: StepFailure = {
          stage: "pose",
          ...classified,
          httpStatus: passError instanceof ProviderHttpError ? passError.status : undefined,
          detail: `ok ${succeeded}/${passFrames.length} ${firstFailureDetail}`,
        };
        const remainingMs = PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart);
        const delay = stepRetryDelayMs(failure, pass, remainingMs, STEP_BUDGET_MS.pose, passError instanceof ProviderHttpError ? passError.retryAfter : null);
        if (delay === null) {
          const stepError = new StepError(failure);
          stepError.stepAttempts = pass;
          throw stepError;
        }
        logEvent("step_retry", { stage: "pose", category: failure.category, http_status: failure.httpStatus ?? null, step_attempt: pass, delay_ms: delay, ok: succeeded, total: passFrames.length });
        await sleep(delay);
      }
      const passTrusted = roboflowResults.filter((f): f is TrustedFrame => f !== null);
      logEvent("pose_pass_complete", {
        requested: passFrames.length,
        succeeded: passTrusted.length,
        frame_retries: roboflowRetryCount,
      });
      return passTrusted;
      }

      // Pose-presence gate: Roboflow answering a frame isn't the same as it
      // finding a golfer in it (a frame with zero reliable keypoints still
      // "succeeds" above). Too few frames with a usable body (shoulders, hips,
      // a wrist) means the golfer wasn't fully in frame, so fail with a re-film
      // message before spending a Gemini call on a swing nobody can see.
      function logCoverage(pass: PosePassName, coverage: { usable: number; total: number }, tally: PoseSignalTally, frameSize: { width: number; height: number } | undefined, scale: unknown) {
        logEvent("pose_coverage", {
          pass,
          usable: coverage.usable,
          total: coverage.total,
          kp_obj: tally.withKeypointsObject,
          kp_any: tally.withAnyKeypoint,
          kp_reliable: tally.withReliableKeypoint,
          max_kp_conf: tally.maxKeypointConfidence,
          max_person_conf: tally.maxPersonConfidence,
          frame_w: frameSize?.width ?? null,
          frame_h: frameSize?.height ?? null,
          scale: typeof scale === "number" ? scale : null,
        });
      }
      await enterStage("pose");
      const poseSignal = emptyPoseSignalTally();
      const firstTrusted = await runCoarsePosePass(frames, { scale: coordinateScale, tally: poseSignal });
      if (firstTrusted === null) return;
      let trustedFrames: TrustedFrame[] = firstTrusted;
      let posePass: PosePassName = "standard";
      await enterStage("pose_gate");
      const coverage = poseCoverage(trustedFrames);
      const frameSize = jpegSizeFromBase64(frames[0].base64);
      logCoverage("standard", coverage, poseSignal, frameSize, coordinateScale);
      if (coverage.ratio < POSE_PRESENCE_MIN_RATIO) {
        const firstDetail = formatPoseGateDetail(coverage, poseSignal, frameSize, coordinateScale);
        // Full-resolution safety net: ONE more extraction + coarse pass at a
        // larger long side, only on this failure and only when the first pass
        // was actually downscaled (scale > 1) and the deadline still covers it
        // plus everything after the gate. Same row, same attempt. Any failure
        // in the safety net falls back to the original pose_not_found.
        const remainingMs = PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart);
        if (!shouldRunFullResPoseRetry(coordinateScale, remainingMs, FULL_RES_RETRY_BUDGET_MS)) {
          throw hardFailure("pose_gate", "pose_not_found", firstDetail);
        }
        logEvent("pose_fullres_retry", { first_usable: coverage.usable, first_total: coverage.total, max_long_side: FULL_RES_RETRY_LONG_SIDE });
        let retryOutcome: string;
        try {
          await enterStage("pose");
          const retryExtract = await extractCoarseFrames(FULL_RES_RETRY_LONG_SIDE);
          const retryTally = emptyPoseSignalTally();
          const retryTrusted = await runCoarsePosePass(retryExtract.frames, { scale: retryExtract.coordinateScale, tally: retryTally });
          if (retryTrusted === null) return;
          await enterStage("pose_gate");
          const retryCoverage = poseCoverage(retryTrusted);
          const retryFrameSize = jpegSizeFromBase64(retryExtract.frames[0].base64);
          logCoverage("full_resolution_retry", retryCoverage, retryTally, retryFrameSize, retryExtract.coordinateScale);
          if (retryCoverage.ratio >= POSE_PRESENCE_MIN_RATIO) {
            frames = retryExtract.frames;
            coordinateScale = retryExtract.coordinateScale;
            frameLongSide = FULL_RES_RETRY_LONG_SIDE;
            trustedFrames = retryTrusted;
            posePass = "full_resolution_retry";
            retryOutcome = "rescued";
          } else {
            retryOutcome = `usable ${retryCoverage.usable}/${retryCoverage.total} kp_reliable ${retryTally.withReliableKeypoint}/${retryTally.frames} frame ${retryFrameSize ? `${retryFrameSize.width}x${retryFrameSize.height}` : "unknown"}`;
          }
        } catch (err) {
          if (settled) return;
          retryOutcome = `error ${err instanceof StepError ? `${err.failure.category}@${err.failure.stage}` : safeErrorName(err)}`;
        }
        logEvent("pose_fullres_retry_result", { result: retryOutcome === "rescued" ? "rescued" : "not_rescued" });
        if (posePass !== "full_resolution_retry") {
          throw hardFailure("pose_gate", "pose_not_found", `${firstDetail} | fullres ${retryOutcome}`);
        }
      }

      // --- Stage 2: dense sampling around the fastest part of the swing.
      // Finds the coarse frame with peak wrist velocity — a metric Roboflow
      // already computed, no extra call needed to estimate it — then
      // requests a small number of additional frames at higher fps in a
      // tight window around it. This refines exactly the phase pose-only
      // analysis is weakest at (impact timing) without paying dense-fps
      // cost across the whole clip, and never runs a second Gemini call
      // (both stages feed the single Gemini call below). A failure or
      // no-op here never fails the analysis — it's a refinement on top of
      // an already-sufficient coarse pass, not a requirement.
      let denseTrustedFrames: TrustedFrame[] = [];
      let denseRetryCount = 0;
      const coarseWindowStart = frames[0]?.timestampSeconds ?? 0;
      const coarseWindowEnd = frames[frames.length - 1]?.timestampSeconds ?? coarseWindowStart;
      if (ADAPTIVE_DENSE_SAMPLING_ENABLED && coarseWindowEnd - coarseWindowStart >= MIN_COARSE_WINDOW_FOR_DENSE_PASS_SECONDS) {
        // Roboflow's own wrist_vertical_velocity_normalized_per_frame metric
        // was observed null on every frame of a real production analysis
        // (0/45) despite normalized_wrist_y — the raw position — being
        // present on 40/45. Computing velocity ourselves from consecutive
        // coarse frames' wrist_y is far more robust than depending on a
        // Roboflow-computed field that's apparently rarely populated.
        let peakFrame: TrustedFrame | undefined;
        let peakAbsVelocity = -1;
        let prevY: number | undefined;
        let prevT: number | undefined;
        for (const f of trustedFrames) {
          const y = f.body_metrics.normalized_wrist_y;
          if (typeof y === "number") {
            if (typeof prevY === "number" && typeof prevT === "number") {
              const dt = f.timestamp_seconds - prevT;
              if (dt > 0) {
                const velocity = Math.abs((y - prevY) / dt);
                if (velocity > peakAbsVelocity) {
                  peakAbsVelocity = velocity;
                  peakFrame = f;
                }
              }
            }
            prevY = y;
            prevT = f.timestamp_seconds;
          }
        }
        if (peakFrame) {
          const denseStart = Math.max(coarseWindowStart, peakFrame.timestamp_seconds - DENSE_IMPACT_WINDOW_SECONDS);
          const denseEnd = Math.min(coarseWindowEnd, peakFrame.timestamp_seconds + DENSE_IMPACT_WINDOW_SECONDS);
          if (denseEnd - denseStart >= 0.2) {
            try {
              const denseExtractRes = await fetch(FRAME_EXTRACT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${frameExtractSecret}` },
                body: JSON.stringify({ videoUrl: effectiveVideoUrl, fps: DENSE_IMPACT_FPS, startSeconds: denseStart, endSeconds: denseEnd, maxLongSide: frameLongSide }),
                signal: requestSignal(TIMEOUT_MS.extract),
              });
              if (denseExtractRes.ok) {
                const denseExtractBody = await denseExtractRes.json();
                // Same video and rule, so the same scale as the coarse pass;
                // if this response disagrees, skip the dense refinement rather
                // than mix coordinate spaces.
                if (denseExtractBody.coordinateScale !== coordinateScale) throw new Error("dense pass coordinateScale mismatch");
                const denseFrames: ExtractedFrame[] = (denseExtractBody.frames ?? []).map(
                  (f: { frameIndex: number; timestampSeconds: number; base64: string }) => ({
                    frameIndex: frames.length + f.frameIndex,
                    timestampSeconds: f.timestampSeconds,
                    base64: f.base64,
                  }),
                );
                const denseResults = await mapWithAdaptiveConcurrency(denseFrames, roboflowGate, async (frame) => {
                  const result = await callRoboflowWithRetry(frame, { scale: coordinateScale }, () => denseRetryCount++);
                  if (!result.frame) devLog("dense frame failed after retries", { error: result.error instanceof ProviderHttpError ? result.error.message : safeErrorName(result.error) });
                  return result.frame;
                });
                denseTrustedFrames = denseResults.filter((f): f is TrustedFrame => f !== null);
                devLog("dense impact-window pass complete", {
                  windowStart: denseStart,
                  windowEnd: denseEnd,
                  requested: denseFrames.length,
                  succeeded: denseTrustedFrames.length,
                });
              }
            } catch (err) {
              devLog("dense impact-window pass failed, continuing with coarse-only data", {
                error: safeErrorName(err),
              });
            }
          }
        }
      }

      if (settled) return;
      const allTrustedFrames = [...trustedFrames, ...denseTrustedFrames].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
      trustedPoseData = {
        video: {
          analysis_fps: ANALYSIS_FPS,
          frames_requested: frames.length,
          frames_analyzed: trustedFrames.length,
          dense_impact_window_frames_analyzed: denseTrustedFrames.length,
          pose_pass: posePass,
        },
        frames: allTrustedFrames,
        limitations:
          trustedFrames.length < frames.length
            ? [`${frames.length - trustedFrames.length} of ${frames.length} sampled frames could not be reliably analyzed and were excluded.`]
            : [],
      };
      logEvent("pose_ready", { frames_requested: frames.length, frames_analyzed: trustedFrames.length, dense: denseTrustedFrames.length, roboflow_retries: roboflowRetryCount + denseRetryCount, concurrency: roboflowGate.limit });

      // Checkpoint for a Try again (best-effort: a failure here only means a
      // retry redoes the pose work). Removed when this analysis completes.
      {
        const fields = {
          analysisId: row.id,
          attempt,
          sourceKey: preprocessingSourceKey,
          ...trimFields(trimWindow),
          pipelineVersion: PREPROCESSING_VERSION,
          pose: trustedPoseData,
        };
        const sig = await signCheckpoint(checkpointSecret, fields);
        const { error: saveCheckpointError } = await supabase.rpc("save_caddie_preprocessing", {
          p_analysis_id: row.id,
          p_attempt: attempt,
          p_source_key: preprocessingSourceKey,
          p_trim_start_seconds: fields.trimStartSeconds,
          p_trim_end_seconds: fields.trimEndSeconds,
          p_pipeline_version: PREPROCESSING_VERSION,
          p_pose: trustedPoseData,
          p_sig: sig,
        });
        if (saveCheckpointError) logEvent("preprocessing_save_failed", {}, "error");
      }
    }

    // --- Gemini: structured JSON output, now given the trusted pose data too. ---
    type ParsedAnalysis = {
      summary: string;
      camera_angle: string;
      strengths: string[];
      work_on: { issue: string; why_it_matters: string; confidence: string }[];
      focus: { title: string; instruction: string };
      drill: { name: string; steps: string[] };
      limitations: string[];
      phases: Record<string, unknown>;
      score: Record<string, { points: number; reason: string }>;
      // Optional, untrusted until withSanitizedCheckpointCues() below.
      checkpoint_cues?: unknown;
    };
    const genStart = Date.now();
    // Every file uploaded by this attempt (one per upload try), all deleted
    // in the finally below.
    const geminiFiles: string[] = [];
    const safeToken = (v: unknown) => (typeof v === "string" && /^[A-Z_]{1,40}$/.test(v) ? v : "none");
    let parsed: ParsedAnalysis;
    try {
      await enterStage("gemini_upload");
      const geminiFile = await runStep("gemini_upload", async () => {
        // The key travels in the x-goog-api-key header, never the URL: a URL
        // ends up in thrown fetch errors and therefore anywhere they're logged.
        const startRes = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files`, {
          method: "POST",
          headers: {
            ...geminiAuth,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(videoBytes.byteLength),
            "X-Goog-Upload-Header-Content-Type": videoContentType,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ file: { display_name: `swing-${row.id}-a${attempt}` } }),
          signal: requestSignal(TIMEOUT_MS.geminiPoll),
        });
        const uploadUrl = startRes.headers.get("x-goog-upload-url");
        if (!startRes.ok || !uploadUrl) {
          throw httpStepError("gemini_upload", startRes.ok ? 502 : startRes.status, await startRes.text().catch(() => ""), startRes.headers);
        }
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Length": String(videoBytes.byteLength),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
          },
          body: videoBytes,
          signal: requestSignal(TIMEOUT_MS.geminiUpload),
        });
        if (!uploadRes.ok) throw httpStepError("gemini_upload", uploadRes.status, await uploadRes.text().catch(() => ""), uploadRes.headers);
        const file = (await uploadRes.json())?.file;
        if (!file?.uri || !file?.name) throw new StepError({ stage: "gemini_upload", category: "provider_unavailable", retryable: true, detail: "no file uri" });
        geminiFiles.push(file.name);
        return { name: file.name as string, uri: file.uri as string, mimeType: (file.mimeType as string | undefined) ?? videoContentType, state: file.state as string | undefined };
      });

      // Wait for ACTIVE within a budget that always leaves room for
      // generateContent before the deadline. FAILED = Gemini couldn't decode
      // the video (not "busy"); still PROCESSING at the end = transient.
      await enterStage("gemini_processing");
      let state = geminiFile.state;
      const waitStart = Date.now();
      const waitBudgetMs = () =>
        Math.min(GEMINI_ACTIVE_WAIT_MAX_MS, PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart) - GEMINI_GENERATE_RESERVE_MS + (Date.now() - waitStart));
      let pollFailures = 0;
      while (state === "PROCESSING" && Date.now() - waitStart < waitBudgetMs()) {
        if (settled) return;
        await sleep(GEMINI_ACTIVE_POLL_MS);
        try {
          const pollRes = await fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}`, { headers: geminiAuth, signal: requestSignal(TIMEOUT_MS.geminiPoll) });
          if (!pollRes.ok) {
            const pollBody = await pollRes.text().catch(() => "");
            if (!isRetryableStatus(pollRes.status)) throw httpStepError("gemini_processing", pollRes.status, pollBody, pollRes.headers);
            pollFailures++;
          } else {
            state = (await pollRes.json())?.state;
          }
        } catch (err) {
          if (err instanceof StepError) throw err;
          pollFailures++;
          if (pollFailures >= 5) throw thrownStepError("gemini_processing", err);
        }
      }
      const stateFailure = classifyGeminiFileState(state);
      if (stateFailure) {
        throw new StepError({
          stage: "gemini_processing",
          ...stateFailure,
          detail: `file state ${safeToken(state)} after ${Math.round((Date.now() - waitStart) / 1000)}s, ${pollFailures} poll errors`,
        });
      }
      logEvent("gemini_file_active", { wait_ms: Date.now() - waitStart });

      const localeName = LOCALE_NAMES[locale];
      const userPromptParts = [
        row.swing_type ? `The golfer says this is a: ${row.swing_type}.` : "",
        `Remember: respond in ${localeName} (see the system instruction's language requirement).`,
        "Analyze this golf swing video and return your structured feedback, using TRUSTED_POSE_DATA below as the authoritative source for body-position claims and phase timestamps.",
        `TRUSTED_POSE_DATA: ${JSON.stringify(trustedPoseData)}`,
      ]
        .filter(Boolean)
        .join(" ");

      const genRequestBody = JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(localeName) }] },
          contents: [
            {
              role: "user",
              parts: [{ fileData: { fileUri: geminiFile.uri, mimeType: geminiFile.mimeType } }, { text: userPromptParts }],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: buildResponseSchema(localeName),
            // The sampled "low" arm only (CADDIE_THINKING_LOW_SAMPLE, off by
            // default). "default" sends no thinkingConfig: exactly as before.
            ...(thinkingArm === "low" ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          },
        });
      // 429/5xx/network from Gemini is usually gone within seconds, and an
      // empty/unparseable/invalid answer is worth exactly one more try:
      // runStep re-runs generate + parse + validate together.
      await enterStage("gemini_generate");
      parsed = await runStep("gemini_generate", async (tryIndex) => {
        // This try's own timeout: the 60/75/75 s schedule, capped so it ends
        // TERMINAL_RESERVE_MS before the deadline. runStep only starts a
        // retry when at least GEMINI_GENERATE_MIN_TRY_MS of it would fit, so
        // null here means the deadline moved under us (a long back-off).
        const remainingMs = PIPELINE_DEADLINE_MS - (Date.now() - pipelineStart);
        const tryTimeoutMs = geminiGenerateTryTimeoutMs(tryIndex, remainingMs);
        if (tryTimeoutMs === null) {
          throw new StepError({ stage: "gemini_generate", category: "deadline_exceeded", retryable: true, detail: `no time for try ${tryIndex}, ${Math.round(remainingMs / 1000)}s left` }, null, "timeout");
        }
        lastRequestTimeoutMs.set("gemini_generate", tryTimeoutMs);
        const tryStart = Date.now();
        const tryLog = (outcome: string, extra: Record<string, unknown> = {}) =>
          logEvent("gemini_try", { stage: "gemini_generate", model: GEMINI_MODEL, thinking_level: thinkingArm, try: tryIndex, request_timeout_ms: tryTimeoutMs, request_ms: Date.now() - tryStart, outcome, ...extra });
        let genRes: Response;
        let genBody: Record<string, unknown> & { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: unknown }[]; promptFeedback?: { blockReason?: unknown } };
        try {
          genRes = await fetch(`${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...geminiAuth },
            body: genRequestBody,
            signal: requestSignal(tryTimeoutMs),
          });
          if (!genRes.ok) {
            const stepError = httpStepError("gemini_generate", genRes.status, await genRes.text().catch(() => ""), genRes.headers);
            tryLog("http", { http_status: genRes.status, category: stepError.failure.category, retry_after: genRes.headers.get("retry-after") !== null });
            throw stepError;
          }
          genBody = await genRes.json();
        } catch (err) {
          if (err instanceof StepError) throw err;
          const stepError = thrownStepError("gemini_generate", err);
          // Our own timeout vs. the network vs. the attempt being settled.
          tryLog(stepError.kind);
          throw new StepError(
            { ...stepError.failure, detail: `${stepError.failure.detail} after ${Date.now() - tryStart}ms of ${tryTimeoutMs}ms, try ${tryIndex}` },
            null,
            stepError.kind,
          );
        }
        tryLog("responded");
        const candidate = genBody?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        const finish = `finish ${safeToken(candidate?.finishReason)} block ${safeToken(genBody?.promptFeedback?.blockReason)}`;
        if (!text) throw new StepError({ stage: "gemini_generate", category: "model_output_invalid", retryable: true, detail: `no text part, ${finish}` });
        let candidateJson: ParsedAnalysis;
        try {
          candidateJson = JSON.parse(text);
        } catch {
          // Never the SyntaxError's message: it quotes the model's text.
          throw new StepError({ stage: "output_validation", category: "model_output_invalid", retryable: true, detail: `JSON parse failed, ${finish}` });
        }
        if (
          !candidateJson?.summary ||
          !Array.isArray(candidateJson.work_on) ||
          !candidateJson.focus ||
          !candidateJson.drill ||
          !candidateJson.phases ||
          !candidateJson.score
        ) {
          throw new StepError({ stage: "output_validation", category: "model_output_invalid", retryable: true, detail: `shape validation, ${finish}` });
        }
        return candidateJson;
      });
      logEvent("gemini_responded", { latency_ms: Date.now() - genStart });
    } finally {
      // Best-effort cleanup — never blocks either way.
      for (const name of geminiFiles) fetch(`${GEMINI_API_BASE}/v1beta/${name}`, { method: "DELETE", headers: geminiAuth }).catch(() => {});
    }

    // The 0-100 total is computed here, not trusted from Gemini's own
    // arithmetic — sum of the 5 criteria, each clamped to 0-20 first so a
    // single malformed value can't skew the total outside 0-100 (the
    // score column's own check constraint would otherwise reject the
    // whole save over one bad field).
    const scoreCriteria = Object.values(parsed.score ?? {});
    const totalScore = scoreCriteria.reduce((sum, c) => sum + Math.max(0, Math.min(20, Math.round(c.points ?? 0))), 0);

    // Per-checkpoint cues are optional and additive: unknown keys, empty or
    // markdown-only values and cues for unplaced moments are dropped, long
    // ones capped; if nothing survives the field is left out entirely. This
    // never throws and never fails the analysis.
    // Same for the optional work_on[].checkpoint tag: an invalid tag is
    // removed from its item, the item itself is kept.
    // Then the measured-verdict check (_shared/caddieVerdicts.ts): Gemini
    // wrote its cues without seeing what the pose measurement finds, so a
    // cue that coaches a different body part than a measured fault at the
    // same moment is dropped (never rewritten). `language` records the
    // locale this text was requested in, so the client can offer a
    // translation when the app's language differs (translate-caddie-
    // analysis updates it). Rows from before this have no field.
    const { json: checkedJson, dropped: droppedCues } = withMeasuredCueCheck(
      withSanitizedWorkOnCheckpoints(withSanitizedCheckpointCues(parsed as unknown as Record<string, unknown>)),
      trustedPoseData,
    );
    const analysisJson: Record<string, unknown> = { ...checkedJson, language: locale, thinking_level: thinkingArm };
    devLog("checkpoint cues", { kept: Object.keys((analysisJson.checkpoint_cues as Record<string, string> | undefined) ?? {}), droppedByMeasurement: droppedCues });

    if (settled) return;
    await enterStage("save");
    const savedRows = await runStep("save", async () => {
    const { data: savedRows, error: updateError } = await supabase
      .from("caddie_analyses")
      .update({
        status: "complete",
        stage: "save",
        stage_updated_at: new Date().toISOString(),
        failure_stage: null,
        failure_category: null,
        failure_retryable: null,
        provider_http_status: null,
        error_message: null,
        // When the golfer picked a window, the row's video becomes the
        // ACTUALLY trimmed private copy (stored by path; effectiveVideoUrl
        // is only a signed link and is never saved). Otherwise the media
        // columns are left exactly as inserted.
        ...(trimmedPath ? { source_media_path: trimmedPath, source_media_url: null } : {}),
        analysis_json: analysisJson,
        roboflow_analysis_json: trustedPoseData,
        analysis_summary: parsed.summary,
        strengths: (parsed.strengths ?? []).slice(0, 3),
        issues: parsed.work_on.map((w) => w.issue),
        recommendations: parsed.work_on.map((w) => w.why_it_matters),
        drills: parsed.drill?.name ? [parsed.drill.name] : [],
        camera_angle: parsed.camera_angle,
        score: totalScore,
        model: GEMINI_MODEL,
      })
      .eq("id", row.id)
      // Never overwrite a row the deadline already marked failed, nor a
      // newer attempt of this row.
      .eq("status", "processing")
      .eq("attempt", attempt)
      .select("id");
    if (updateError) {
      // Roboflow+Gemini succeeded but the save failed (e.g. the caller's JWT
      // expired). Retried by runStep; if it still fails the row is marked
      // failed (save_failed, retryable) so it doesn't sit at 'processing'.
      throw new StepError({ stage: "save", category: "save_failed", retryable: true, detail: redactDetail(updateError.message, 160) });
    }
    return savedRows;
    });
    if (!savedRows || savedRows.length === 0) {
      logEvent("result_discarded", { reason: "row no longer processing for this attempt" });
      settle();
      return;
    }
    settle();
    logEvent("complete", { stage: "save", total_ms: Date.now() - pipelineStart, thinking_level: thinkingArm, pose_reused: !!reusedPose });
    // The untrimmed private original is now unreferenced (this row points at
    // the trimmed copy) unless another of the caller's rows still uses it —
    // remove it rather than leave a private orphan. Best-effort; never a
    // community-media object (those belong to posts / P2-10's cleanup).
    if (trimmedPath && row.source_media_path && row.source_media_path !== trimmedPath) {
      const { count: stillUsed, error: usedError } = await supabase
        .from("caddie_analyses")
        .select("id", { count: "exact", head: true })
        .eq("source_media_path", row.source_media_path);
      if (!usedError && stillUsed === 0) {
        const { error: removeError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).remove([row.source_media_path]);
        if (removeError) console.error("[analyze-swing] couldn't remove the untrimmed original.", { rowId: row.id, reason: redactDetail(removeError.message, 160) });
      }
    }
    devLog("saved", {
      id: row.id,
      processingSeconds: (Date.now() - pipelineStart) / 1000,
      framesRequested: trustedPoseData.video.frames_requested,
      framesAnalyzed: trustedPoseData.video.frames_analyzed,
      denseFramesAnalyzed: trustedPoseData.video.dense_impact_window_frames_analyzed,
      poseReused: !!reusedPose,
      analysisFps: ANALYSIS_FPS,
      workflowId: ROBOFLOW_WORKFLOW_ID,
    });
  }

  // Race the pipeline against PIPELINE_DEADLINE_MS so the row always
  // reaches a terminal state before the platform's wall-clock limit kills
  // the worker (which used to leave it 'processing' for the client's 10 min
  // stale fallback). An unexpected throw is a failure too, not a hang.
  async function runWithDeadline(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), PIPELINE_DEADLINE_MS);
    });
    const run = runPipeline().then(
      () => "done" as const,
      async (err) => {
        await fail({ stage: currentStage, category: "internal", retryable: false, detail: `pipeline threw ${safeErrorName(err)}` });
        return "done" as const;
      },
    );
    const outcome = await Promise.race([run, deadline]);
    clearTimeout(timer);
    if (outcome === "timeout") {
      // fail() also aborts whatever request is still open.
      await fail({ stage: currentStage, category: "deadline_exceeded", retryable: true, detail: `pipeline exceeded ${PIPELINE_DEADLINE_MS / 1000}s` }, 1, "timeout");
    }
  }

  EdgeRuntime.waitUntil(runWithDeadline());
  return jsonResponse({ analysis: row }, 200);
});
