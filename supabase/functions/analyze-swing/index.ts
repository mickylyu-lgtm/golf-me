// Real Caddie swing analysis, server-side. GEMINI_API_KEY lives only here
// (a Supabase Edge Function secret, injected into Deno.env automatically —
// same posture as every other secret in this project, see delete-account
// and course-search) and never reaches the client, a log line, or a
// response body.
//
// This function is the only integration point for a real analysis
// provider — see src/lib/swingAnalysis.ts on the frontend, which this
// replaces. It owns the full lifecycle of a caddie_analyses row for a
// request: insert at 'processing' (so rate-limiting/duplicate-detection has
// something to look at even mid-request), then update to 'complete' or
// 'failed'. It never fabricates a result — a Gemini failure updates the row
// to 'failed' with a safe, non-sensitive error_message, never invented
// feedback (see REQUIRED TEST — FAILURE in the product brief).
//
// Every DB operation here uses a client scoped to the CALLER's own JWT
// (forwarded Authorization header against the anon key), not the service
// role — caddie_analyses' existing RLS (owner-only select/insert/update)
// and its ownership trigger (Ask Caddie only on your own community posts,
// see migration 20260817091500) already enforce everything this function
// needs, so there is no reason to bypass them with a service-role client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Centralized config — change these, nothing else, to retune Caddie. ----
const GEMINI_MODEL = "gemini-3.6-flash"; // gemini-2.5-flash was retired for new API keys/projects (Gemini API started 404ing it with "no longer available to new users" on 2026-08-21); 3.6-flash is Google's named replacement, same video-understanding + structured-JSON-output support
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const COOLDOWN_SECONDS = 30; // blocks accidental double-taps/rapid re-asks
const DAILY_LIMIT_PER_USER = 10; // caps worst-case per-user Gemini spend for the beta
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // matches the community-media Storage bucket's own file_size_limit
const STALE_PROCESSING_MINUTES = 5; // a 'processing' row older than this is treated as abandoned, not an active duplicate
const FILE_ACTIVE_POLL_ATTEMPTS = 6;
const FILE_ACTIVE_POLL_DELAY_MS = 2000;

const SUPPORTED_LOCALES = new Set(["en", "zh-CN", "zh-TW", "es", "ko", "ja"]);
const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  es: "Spanish",
  ko: "Korean",
  ja: "Japanese",
};

// Gemini's Files API currently samples video at a fixed 1 frame/second with
// no reliably-working way to raise that for a short, fast clip — the
// documented `video_metadata.fps` request field returns a 500 on the
// Gemini Developer API today (googleapis/python-genai#854, closed
// "not planned"), so this function deliberately does not send it rather
// than shipping a field that breaks every request. Mitigation instead:
// the system prompt below tells the model explicitly that sampling is
// coarse relative to how fast a swing moves, and to fold that into
// per-item confidence/limitations rather than claiming precision the
// frame rate can't support.
const SYSTEM_PROMPT = `You are GolfMe Caddie, a conservative golf swing feedback assistant for recreational golfers. This is a BETA feature, not a professional biomechanics system or launch monitor.

Rules:
- Analyze only what is clearly, visibly supportable from the supplied video. Never invent measurements (exact clubface degrees, swing speed, attack angle, launch angle, shaft lean) unless a number is genuinely, visibly obvious.
- The video is sampled at roughly 1 frame per second by the platform you're viewing it through. A full golf swing takes well under 2 seconds, so fast phases (transition, impact) may fall between sampled frames. When you're not confident you actually saw a fast phase clearly, say so — lower that item's confidence or note it in limitations rather than guessing.
- Never diagnose injuries or physical/medical conditions. Keep all wording golf-technique-focused (e.g. "your finish appears off-balance," never "you have a hip mobility problem").
- Never claim professional certification or present yourself as a replacement for a human instructor.
- Identify the camera angle (face_on, down_the_line, other, or uncertain) and only make claims that angle actually supports: face-on supports weight shift/lateral movement observations; down-the-line supports posture/swing-plane-tendency observations. Don't make a claim a camera angle wouldn't support.
- Be concise. Prioritize the most meaningful observations over listing every possible issue: up to 3 strengths, up to 3 work-on items, exactly 1 main focus, exactly 1 drill.
- Respond with feedback suitable for a recreational golfer, not jargon-heavy technical analysis.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "1-2 sentence overall take." },
    camera_angle: { type: "STRING", enum: ["face_on", "down_the_line", "other", "uncertain"] },
    strengths: { type: "ARRAY", items: { type: "STRING" }, description: "Up to 3 clearly visible strengths." },
    work_on: {
      type: "ARRAY",
      description: "Up to 3 areas to work on, most important first.",
      items: {
        type: "OBJECT",
        properties: {
          issue: { type: "STRING" },
          why_it_matters: { type: "STRING" },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["issue", "why_it_matters", "confidence"],
      },
    },
    focus: {
      type: "OBJECT",
      description: "The single most important thing to focus on next.",
      properties: { title: { type: "STRING" }, instruction: { type: "STRING" } },
      required: ["title", "instruction"],
    },
    drill: {
      type: "OBJECT",
      description: "One simple drill supporting the focus.",
      properties: { name: { type: "STRING" }, steps: { type: "ARRAY", items: { type: "STRING" } } },
      required: ["name", "steps"],
    },
    limitations: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Honest caveats — e.g. camera angle or video quality prevented a confident read on something.",
    },
  },
  required: ["summary", "camera_angle", "strengths", "work_on", "focus", "drill", "limitations"],
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// Development-only, safe fields — never the API key, a full video URL, an
// auth token, or Gemini's raw error body.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error("[analyze-swing] GEMINI_API_KEY is not configured.");
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
  // starting a second Gemini call. A stale 'processing' row (crashed mid-
  // request, never reached the update step) doesn't count — it must not
  // permanently block retries.
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

  // A failed attempt is deleted outright rather than left behind as a
  // 'failed' row — a golfer's Caddie history would otherwise accumulate
  // "Caddie couldn't analyze this swing" entries from transient provider
  // issues (rate limits, a bad model name, a flaky upload) that have
  // nothing to do with their swing. The full reason still reaches the
  // function logs via console.error below, which is enough for debugging;
  // it just never needs to persist as a permanent, user-visible row.
  async function fail(errorMessage: string, publicMessage: string, status: number): Promise<Response> {
    console.error("[analyze-swing] analysis failed.", { rowId: row.id, reason: errorMessage });
    await supabase.from("caddie_analyses").delete().eq("id", row.id);
    return jsonResponse({ error: publicMessage }, status);
  }

  // Fetch the swing video. community-media is a public-read bucket (same
  // as every other post's media in this app today), so a plain server-side
  // GET is the correct, simplest approach — no signed URL needed, and this
  // function never makes a private video public to satisfy Gemini.
  let videoBytes: ArrayBuffer;
  let videoContentType: string;
  try {
    const videoRes = await fetch(row.source_media_url);
    if (!videoRes.ok) return await fail(`video fetch ${videoRes.status}`, "Caddie couldn't access this swing video.", 502);
    videoContentType = videoRes.headers.get("content-type") ?? "video/mp4";
    videoBytes = await videoRes.arrayBuffer();
  } catch (err) {
    return await fail(`video fetch threw: ${err instanceof Error ? err.message : String(err)}`, "Caddie couldn't access this swing video.", 502);
  }
  if (videoBytes.byteLength === 0) return await fail("video fetch returned 0 bytes", "This swing video looks empty. Please try a different clip.", 400);
  if (videoBytes.byteLength > MAX_VIDEO_BYTES) return await fail("video too large", "This video is too large for Caddie.", 400);
  devLog("video fetched", { bytes: videoBytes.byteLength, contentType: videoContentType });

  // --- Gemini Files API: resumable upload, then poll for ACTIVE. ---
  let geminiFile: { name: string; uri: string; mimeType: string };
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
      return await fail(`Gemini upload start ${startRes.status}: ${errBody.slice(0, 500)}`, "Caddie couldn't analyze this swing.", 502);
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
      return await fail(`Gemini upload finalize ${uploadRes.status}: ${errBody.slice(0, 500)}`, "Caddie couldn't analyze this swing.", 502);
    }
    const uploadBody = await uploadRes.json();
    const file = uploadBody.file;
    if (!file?.uri || !file?.name) return await fail("Gemini upload response missing file.uri/name", "Caddie couldn't analyze this swing.", 502);
    geminiFile = { name: file.name, uri: file.uri, mimeType: file.mimeType ?? videoContentType };

    let state = file.state as string;
    for (let attempt = 0; state === "PROCESSING" && attempt < FILE_ACTIVE_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, FILE_ACTIVE_POLL_DELAY_MS));
      const pollRes = await fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}?key=${geminiApiKey}`);
      if (!pollRes.ok) break;
      const pollBody = await pollRes.json();
      state = pollBody.state;
    }
    if (state !== "ACTIVE") return await fail(`Gemini file never reached ACTIVE (last state: ${state})`, "Caddie is taking longer than usual — please try again.", 504);
    devLog("gemini file active", { name: geminiFile.name });
  } catch (err) {
    return await fail(`Gemini upload threw: ${err instanceof Error ? err.message : String(err)}`, "Caddie couldn't analyze this swing.", 502);
  }

  // --- generateContent: structured JSON output. ---
  let parsed: {
    summary: string;
    camera_angle: string;
    strengths: string[];
    work_on: { issue: string; why_it_matters: string; confidence: string }[];
    focus: { title: string; instruction: string };
    drill: { name: string; steps: string[] };
    limitations: string[];
  };
  const genStart = Date.now();
  try {
    const userPromptParts = [
      body.swingType ? `The golfer says this is a: ${body.swingType}.` : "",
      `Respond in ${LOCALE_NAMES[locale]}, in the JSON shape you were given — field names stay in English, but summary/issue/why_it_matters/instruction/name/steps/limitations text should be written in ${LOCALE_NAMES[locale]}.`,
      "Analyze this golf swing video and return your structured feedback.",
    ]
      .filter(Boolean)
      .join(" ");

    const genRes = await fetch(`${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ fileData: { fileUri: geminiFile.uri, mimeType: geminiFile.mimeType } }, { text: userPromptParts }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    if (!genRes.ok) {
      const errBody = await genRes.text().catch(() => "");
      return await fail(`Gemini generateContent ${genRes.status}: ${errBody.slice(0, 500)}`, "Caddie couldn't analyze this swing.", 502);
    }
    const genBody = await genRes.json();
    const text = genBody?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return await fail("Gemini response had no text part", "Caddie couldn't analyze this swing.", 502);
    parsed = JSON.parse(text);
    devLog("gemini responded", { latencyMs: Date.now() - genStart });
  } catch (err) {
    return await fail(`Gemini generateContent threw: ${err instanceof Error ? err.message : String(err)}`, "Caddie couldn't analyze this swing.", 502);
  } finally {
    // Best-effort cleanup — never blocks the response either way.
    fetch(`${GEMINI_API_BASE}/v1beta/${geminiFile.name}?key=${geminiApiKey}`, { method: "DELETE" }).catch(() => {});
  }

  if (!parsed?.summary || !Array.isArray(parsed.work_on) || !parsed.focus || !parsed.drill) {
    return await fail("Gemini response failed shape validation", "Caddie couldn't analyze this swing.", 502);
  }

  const { data: updated, error: updateError } = await supabase
    .from("caddie_analyses")
    .update({
      status: "complete",
      analysis_json: parsed,
      analysis_summary: parsed.summary,
      strengths: (parsed.strengths ?? []).slice(0, 3),
      issues: parsed.work_on.map((w) => w.issue),
      recommendations: parsed.work_on.map((w) => w.why_it_matters),
      drills: parsed.drill?.name ? [parsed.drill.name] : [],
      camera_angle: parsed.camera_angle,
      model: GEMINI_MODEL,
    })
    .eq("id", row.id)
    .select()
    .single();
  if (updateError || !updated) {
    // Gemini succeeded but the save failed — report a save failure
    // honestly (per the brief) rather than claiming success.
    console.error("[analyze-swing] save after successful analysis failed.", updateError?.message);
    return jsonResponse({ error: "Caddie analyzed your swing but saving it failed. Please try again." }, 500);
  }

  devLog("saved", { id: updated.id });
  return jsonResponse({ analysis: updated }, 200);
});
