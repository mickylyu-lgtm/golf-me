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
// It never fabricates a result — any failure deletes the row rather than
// saving invented feedback (see REQUIRED TEST — FAILURE in the product
// brief).
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
// role — caddie_analyses' existing RLS (owner-only select/insert/update/
// delete) and its ownership trigger (Ask Caddie only on your own community
// posts, see migration 20260817091500) already enforce everything this
// function needs, so there is no reason to bypass them with a service-role
// client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Centralized config — change these, nothing else, to retune Caddie. ----
const GEMINI_MODEL = "gemini-3.6-flash"; // gemini-2.5-flash was retired for new API keys/projects (Gemini API started 404ing it with "no longer available to new users" on 2026-08-21); 3.6-flash is Google's named replacement, same video-understanding + structured-JSON-output support
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const COOLDOWN_SECONDS = 30; // blocks accidental double-taps/rapid re-asks
const DAILY_LIMIT_PER_USER = 30; // caps worst-case per-user Gemini+Roboflow spend for the beta — covers both providers together, not separately; raised from 10 for active beta testing (2026-08-22)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // matches the community-media Storage bucket's own file_size_limit
const STALE_PROCESSING_MINUTES = 5; // a 'processing' row older than this is treated as abandoned, not an active duplicate
const FILE_ACTIVE_POLL_ATTEMPTS = 6;
const FILE_ACTIVE_POLL_DELAY_MS = 2000;

// Roboflow's validated, already-deployed six-phase pose workflow — do not
// retrain/replace/rebuild this, see product brief point 37.
const ROBOFLOW_WORKSPACE = "micky-lyu";
const ROBOFLOW_WORKFLOW_ID = "golf-swing-six-phase-analysis-1787307394301";
const ROBOFLOW_ENDPOINT = `https://serverless.roboflow.com/${ROBOFLOW_WORKSPACE}/workflows/${ROBOFLOW_WORKFLOW_ID}`;
// The frame-extraction Node/Vercel function — see api/extract-frames.ts for
// why frame extraction can't happen in this Deno runtime.
const FRAME_EXTRACT_URL = "https://golfme.app/api/extract-frames";
// Roboflow's own HTTP API confirmed stateless across calls (live-tested:
// identical back-to-back requests never advanced frame_number or
// current_phase) — the validated six-phase logic that ran during offline
// testing isn't reproducible over independent per-frame HTTP calls, so
// phase identification happens in the Gemini prompt below instead of a
// reimplemented state machine here.
const ANALYSIS_FPS = 8; // beta tradeoff vs. validation's full ~60fps/every-frame — see DEVELOPMENT_STATUS for the cost math (300+ calls/swing at 60fps vs. ~50-160 at 8fps)
const ROBOFLOW_CONCURRENCY = 8; // parallel frame calls — keeps total wall-clock well inside this project's 400s (Pro plan) Edge Function budget without raising per-swing cost (concurrency doesn't add calls, just shortens wall time)
const ROBOFLOW_MIN_SUCCESS_RATIO = 0.5; // below this fraction of frames successfully analyzed, fail honestly rather than hand Gemini a too-sparse pose signal
const ROBOFLOW_FRAME_RETRY_ATTEMPTS = 2; // total attempts per frame (1 retry) — a transient network/5xx blip on one frame shouldn't cost the whole analysis when a single retry would likely succeed
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

CRITICAL LANGUAGE REQUIREMENT: every piece of free text you write — summary, strengths, work_on issue/why_it_matters, focus title/instruction, drill name/steps, limitations, score reasons — MUST be written in ${localeName}. Only JSON field/key names and enum values (e.g. "high"/"medium"/"low", "face_on") stay in English exactly as specified in the schema. This applies even if the video, TRUSTED_POSE_DATA, or golfer's club name below are in English — the OUTPUT language is ${localeName}, full stop.

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
- Score the swing across exactly these 5 categories, 0-20 points each (100 total): setup_and_posture (address position, balance, alignment), backswing (shoulder turn, structure, tempo into transition), downswing_sequencing (hip/shoulder rotation order, lower-body initiation — only from what TRUSTED_POSE_DATA's angles/timing actually show), balance_and_weight_transfer (weight shift through the swing and into the finish), finish (balance, control, extension at the end). Give each a short one-sentence reason tied to something TRUSTED_POSE_DATA or the video actually shows — never a generic reason. Score conservatively: a phase with sparse/missing pose data should score in the middle of the range with a reason that says so, not a confident extreme in either direction.

REMINDER: write summary, strengths, work_on, focus, drill, limitations, and score reasons in ${localeName}. This is not optional.`;
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
  sourceMediaUrl: string;
  thumbnailUrl?: string;
  swingType?: string;
  locale?: string;
}

interface CaddieAnalysisRow {
  id: string;
  owner_id: string;
  source_type: string;
  source_post_id: string | null;
  source_media_url: string;
  thumbnail_url: string | null;
  swing_type: string | null;
  status: string;
  created_at: string;
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

function filterRoboflowFrame(frameIndex: number, timestampSeconds: number, output: Record<string, unknown>): TrustedFrame {
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
    keypoints,
    body_metrics: bodyMetrics,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Not authenticated." }, 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  if (body.sourceType !== "direct_upload" && body.sourceType !== "community_post") {
    return jsonResponse({ error: "Invalid sourceType." }, 400);
  }
  if (!body.sourceMediaUrl || typeof body.sourceMediaUrl !== "string") {
    return jsonResponse({ error: "sourceMediaUrl is required." }, 400);
  }
  if (body.sourceType === "community_post" && !body.sourcePostId) {
    return jsonResponse({ error: "sourcePostId is required for a community_post analysis." }, 400);
  }
  const locale = body.locale && SUPPORTED_LOCALES.has(body.locale) ? body.locale : "en";

  // Rate limiting — scoped to this user's own rows only, RLS does that for
  // free since `supabase` here carries the caller's JWT, not service role.
  const { data: recentRows, error: recentError } = await supabase
    .from("caddie_analyses")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (recentError) {
    console.error("[analyze-swing] rate-limit lookup failed.", recentError.message);
    return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again." }, 500);
  }
  const lastRequestAt = recentRows?.[0]?.created_at ? new Date(recentRows[0].created_at).getTime() : 0;
  if (lastRequestAt && Date.now() - lastRequestAt < COOLDOWN_SECONDS * 1000) {
    return jsonResponse({ error: "Please wait a moment before asking Caddie again." }, 429);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount, error: dailyError } = await supabase
    .from("caddie_analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (dailyError) {
    console.error("[analyze-swing] daily-limit lookup failed.", dailyError.message);
    return jsonResponse({ error: "Caddie is temporarily unavailable. Please try again." }, 500);
  }
  if ((dailyCount ?? 0) >= DAILY_LIMIT_PER_USER) {
    return jsonResponse({ error: `You've reached today's Caddie analysis limit (${DAILY_LIMIT_PER_USER}). Try again tomorrow.` }, 429);
  }

  // Duplicate-tap protection: an active (recent, still-processing) request
  // for the exact same source already exists — hand that back instead of
  // starting a second Roboflow+Gemini run. A stale 'processing' row
  // (crashed mid-request, never reached the update step) doesn't count —
  // it must not permanently block retries.
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000).toISOString();
  let inFlightQuery = supabase.from("caddie_analyses").select("*").eq("status", "processing").gte("created_at", staleCutoff);
  inFlightQuery =
    body.sourceType === "community_post"
      ? inFlightQuery.eq("source_post_id", body.sourcePostId!)
      : inFlightQuery.eq("source_type", "direct_upload").eq("source_media_url", body.sourceMediaUrl);
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
      : completedQuery.eq("source_type", "direct_upload").eq("source_media_url", body.sourceMediaUrl);
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
      source_media_url: body.sourceMediaUrl,
      thumbnail_url: body.thumbnailUrl ?? null,
      swing_type: body.swingType ?? null,
      status: "processing",
    })
    .select()
    .single();
  if (insertError || !inserted) {
    // The ownership trigger (20260817091500) raises exactly this kind of
    // message for a community_post the caller doesn't own — safe to
    // forward verbatim, it was written to be client-facing.
    const message = insertError?.message ?? "Could not start this analysis.";
    const status = message.includes("only available on your own posts") || message.includes("Source post not found") ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
  const row = inserted as CaddieAnalysisRow;
  const pipelineStart = Date.now(); // credit-budget/latency logging (dev only) — see devLog calls below

  async function fail(errorMessage: string): Promise<void> {
    console.error("[analyze-swing] analysis failed.", { rowId: row.id, reason: errorMessage, processingSeconds: (Date.now() - pipelineStart) / 1000 });
    await supabase.from("caddie_analyses").delete().eq("id", row.id);
  }

  // ---- Everything from here runs AFTER the response below is already
  // sent — this request can't stay open for the full pipeline. The client
  // already has the 'processing' row via the response and via realtime. ----
  async function runPipeline(): Promise<void> {
    // Fetch the swing video. community-media is a public-read bucket (same
    // as every other post's media in this app today), so a plain
    // server-side GET is correct — no signed URL needed, and this function
    // never makes a private video public to satisfy Gemini.
    let videoBytes: ArrayBuffer;
    let videoContentType: string;
    try {
      const videoRes = await fetch(row.source_media_url);
      if (!videoRes.ok) return await fail(`video fetch ${videoRes.status}`);
      videoContentType = videoRes.headers.get("content-type") ?? "video/mp4";
      videoBytes = await videoRes.arrayBuffer();
    } catch (err) {
      return await fail(`video fetch threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (videoBytes.byteLength === 0) return await fail("video fetch returned 0 bytes");
    if (videoBytes.byteLength > MAX_VIDEO_BYTES) return await fail("video too large");
    devLog("video fetched", { bytes: videoBytes.byteLength, contentType: videoContentType });

    // --- Frame extraction (Vercel/Node — see api/extract-frames.ts). ---
    let frames: ExtractedFrame[];
    try {
      const extractRes = await fetch(FRAME_EXTRACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${frameExtractSecret}` },
        body: JSON.stringify({ videoUrl: row.source_media_url, fps: ANALYSIS_FPS }),
      });
      if (!extractRes.ok) {
        const errBody = await extractRes.text().catch(() => "");
        return await fail(`frame extraction ${extractRes.status}: ${errBody.slice(0, 500)}`);
      }
      const extractBody = await extractRes.json();
      frames = (extractBody.frames ?? []).map((f: { frameIndex: number; timestampSeconds: number; base64: string }) => ({
        frameIndex: f.frameIndex,
        timestampSeconds: f.timestampSeconds,
        base64: f.base64,
      }));
      if (frames.length === 0) return await fail("frame extraction returned 0 frames");
      if (frames.length > MAX_ANALYSIS_FRAMES) {
        return await fail(`frame extraction returned ${frames.length} frames, exceeding the ${MAX_ANALYSIS_FRAMES} safety cap (misreported video duration?)`);
      }
      devLog("frames extracted", { count: frames.length, fps: extractBody.analysisFps });
    } catch (err) {
      return await fail(`frame extraction threw: ${err instanceof Error ? err.message : String(err)}`);
    }

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
    let roboflowRetryCount = 0;
    async function callRoboflowOnce(frame: ExtractedFrame): Promise<TrustedFrame | null> {
      const res = await fetch(ROBOFLOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: roboflowApiKey, inputs: { image: { type: "base64", value: frame.base64 } } }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }
      const body = await res.json();
      const output = body?.outputs?.[0];
      if (!output) throw new Error(`no outputs[0] in response: ${JSON.stringify(body).slice(0, 300)}`);
      return filterRoboflowFrame(frame.frameIndex, frame.timestampSeconds, output);
    }
    const roboflowResults = await mapWithConcurrency(frames, ROBOFLOW_CONCURRENCY, async (frame) => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= ROBOFLOW_FRAME_RETRY_ATTEMPTS; attempt++) {
        try {
          return await callRoboflowOnce(frame);
        } catch (err) {
          lastErr = err;
          if (attempt < ROBOFLOW_FRAME_RETRY_ATTEMPTS) roboflowRetryCount++;
        }
      }
      if (!firstFailureDetail) firstFailureDetail = lastErr instanceof Error ? lastErr.message : String(lastErr);
      return null;
    });
    const trustedFrames = roboflowResults.filter((f): f is TrustedFrame => f !== null);
    const successRatio = trustedFrames.length / frames.length;
    devLog("roboflow pass complete", {
      requested: frames.length,
      succeeded: trustedFrames.length,
      successRatio,
      retryCount: roboflowRetryCount,
      workflowId: ROBOFLOW_WORKFLOW_ID,
      firstFailureDetail,
    });
    if (successRatio < ROBOFLOW_MIN_SUCCESS_RATIO) {
      return await fail(`roboflow success ratio too low: ${trustedFrames.length}/${frames.length}${firstFailureDetail ? ` (${firstFailureDetail})` : ""}`);
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
              body: JSON.stringify({ videoUrl: row.source_media_url, fps: DENSE_IMPACT_FPS, startSeconds: denseStart, endSeconds: denseEnd }),
            });
            if (denseExtractRes.ok) {
              const denseExtractBody = await denseExtractRes.json();
              const denseFrames: ExtractedFrame[] = (denseExtractBody.frames ?? []).map(
                (f: { frameIndex: number; timestampSeconds: number; base64: string }) => ({
                  frameIndex: frames.length + f.frameIndex,
                  timestampSeconds: f.timestampSeconds,
                  base64: f.base64,
                }),
              );
              const denseResults = await mapWithConcurrency(denseFrames, ROBOFLOW_CONCURRENCY, async (frame) => {
                let lastErr: unknown;
                for (let attempt = 1; attempt <= ROBOFLOW_FRAME_RETRY_ATTEMPTS; attempt++) {
                  try {
                    return await callRoboflowOnce(frame);
                  } catch (err) {
                    lastErr = err;
                    if (attempt < ROBOFLOW_FRAME_RETRY_ATTEMPTS) denseRetryCount++;
                  }
                }
                devLog("dense frame failed after retries", { error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
                return null;
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
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    const allTrustedFrames = [...trustedFrames, ...denseTrustedFrames].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
    const trustedPoseData = {
      video: {
        analysis_fps: ANALYSIS_FPS,
        frames_requested: frames.length,
        frames_analyzed: trustedFrames.length,
        dense_impact_window_frames_analyzed: denseTrustedFrames.length,
      },
      frames: allTrustedFrames,
      limitations:
        trustedFrames.length < frames.length
          ? [`${frames.length - trustedFrames.length} of ${frames.length} sampled frames could not be reliably analyzed and were excluded.`]
          : [],
    };

    // --- Gemini: structured JSON output, now given the trusted pose data too. ---
    let parsed: {
      summary: string;
      camera_angle: string;
      strengths: string[];
      work_on: { issue: string; why_it_matters: string; confidence: string }[];
      focus: { title: string; instruction: string };
      drill: { name: string; steps: string[] };
      limitations: string[];
      phases: Record<string, unknown>;
      score: Record<string, { points: number; reason: string }>;
    };
    const genStart = Date.now();
    let geminiFile: { name: string; uri: string; mimeType: string } | undefined;
    try {
      const startRes = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files?key=${geminiApiKey}`, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(videoBytes.byteLength),
          "X-Goog-Upload-Header-Content-Type": videoContentType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: `swing-${row.id}` } }),
      });
      if (!startRes.ok || !startRes.headers.get("x-goog-upload-url")) {
        const errBody = await startRes.text().catch(() => "");
        return await fail(`Gemini upload start ${startRes.status}: ${errBody.slice(0, 500)}`);
      }
      const uploadUrl = startRes.headers.get("x-goog-upload-url")!;

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Length": String(videoBytes.byteLength),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body: videoBytes,
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text().catch(() => "");
        return await fail(`Gemini upload finalize ${uploadRes.status}: ${errBody.slice(0, 500)}`);
      }
      const uploadBody = await uploadRes.json();
      const file = uploadBody.file;
      if (!file?.uri || !file?.name) return await fail("Gemini upload response missing file.uri/name");
      geminiFile = { name: file.name, uri: file.uri, mimeType: file.mimeType ?? videoContentType };

      let state = file.state as string;
      for (let attempt = 0; state === "PROCESSING" && attempt < FILE_ACTIVE_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, FILE_ACTIVE_POLL_DELAY_MS));
        const pollRes = await fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}?key=${geminiApiKey}`);
        if (!pollRes.ok) break;
        const pollBody = await pollRes.json();
        state = pollBody.state;
      }
      if (state !== "ACTIVE") return await fail(`Gemini file never reached ACTIVE (last state: ${state})`);
      devLog("gemini file active", { name: geminiFile.name });

      const localeName = LOCALE_NAMES[locale];
      const userPromptParts = [
        body.swingType ? `The golfer says this is a: ${body.swingType}.` : "",
        `Remember: respond in ${localeName} (see the system instruction's language requirement).`,
        "Analyze this golf swing video and return your structured feedback, using TRUSTED_POSE_DATA below as the authoritative source for body-position claims and phase timestamps.",
        `TRUSTED_POSE_DATA: ${JSON.stringify(trustedPoseData)}`,
      ]
        .filter(Boolean)
        .join(" ");

      const genRes = await fetch(`${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          },
        }),
      });
      if (!genRes.ok) {
        const errBody = await genRes.text().catch(() => "");
        return await fail(`Gemini generateContent ${genRes.status}: ${errBody.slice(0, 500)}`);
      }
      const genBody = await genRes.json();
      const text = genBody?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return await fail("Gemini response had no text part");
      parsed = JSON.parse(text);
      devLog("gemini responded", { latencyMs: Date.now() - genStart });
    } catch (err) {
      return await fail(`Gemini call threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Best-effort cleanup — never blocks either way.
      if (geminiFile) fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}?key=${geminiApiKey}`, { method: "DELETE" }).catch(() => {});
    }

    if (!parsed?.summary || !Array.isArray(parsed.work_on) || !parsed.focus || !parsed.drill || !parsed.phases || !parsed.score) {
      return await fail("Gemini response failed shape validation");
    }

    // The 0-100 total is computed here, not trusted from Gemini's own
    // arithmetic — sum of the 5 criteria, each clamped to 0-20 first so a
    // single malformed value can't skew the total outside 0-100 (the
    // score column's own check constraint would otherwise reject the
    // whole save over one bad field).
    const scoreCriteria = Object.values(parsed.score ?? {});
    const totalScore = scoreCriteria.reduce((sum, c) => sum + Math.max(0, Math.min(20, Math.round(c.points ?? 0))), 0);

    const { error: updateError } = await supabase
      .from("caddie_analyses")
      .update({
        status: "complete",
        analysis_json: parsed,
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
      .eq("id", row.id);
    if (updateError) {
      // Roboflow+Gemini succeeded but the save failed — no fallback claim
      // of success, and no point deleting a row whose analysis genuinely
      // completed; leave it for a manual look rather than silently losing it.
      console.error("[analyze-swing] save after successful analysis failed.", { rowId: row.id, reason: updateError.message });
      return;
    }
    devLog("saved", {
      id: row.id,
      processingSeconds: (Date.now() - pipelineStart) / 1000,
      framesRequested: frames.length,
      framesAnalyzed: trustedFrames.length,
      denseFramesAnalyzed: denseTrustedFrames.length,
      totalRoboflowCalls: frames.length + denseTrustedFrames.length,
      analysisFps: ANALYSIS_FPS,
      roboflowRetryCount: roboflowRetryCount + denseRetryCount,
      workflowId: ROBOFLOW_WORKFLOW_ID,
    });
  }

  EdgeRuntime.waitUntil(runPipeline());
  return jsonResponse({ analysis: row }, 200);
});
