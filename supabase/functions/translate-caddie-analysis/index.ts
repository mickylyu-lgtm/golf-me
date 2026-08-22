// Re-translates an EXISTING, already-complete Caddie analysis's free text
// into a different language, on demand — a deliberately separate,
// lightweight function from analyze-swing rather than a mode flag on it.
// Feedback text is generated once, at analysis time, in whatever language
// was selected then (see analyze-swing's buildSystemPrompt/buildResponseSchema
// comments) — it never retroactively changes when the app's UI language is
// switched afterward. This is the explicit, user-requested way to fix that
// for an existing analysis: a text-only Gemini call (no video re-upload, no
// Roboflow re-run) that translates the saved free-text fields in place.
// Numbers, enums (confidence/camera_angle), and phase timestamps are never
// touched — only the prose changes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const COOLDOWN_SECONDS = 5; // just enough to absorb an accidental double-tap on the same analysis, not a real rate limit — this is a cheap text-only call, not worth the daily-analysis-limit machinery

const SUPPORTED_LOCALES = new Set(["en", "zh-CN", "zh-TW", "es", "ko", "ja"]);
const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  es: "Spanish",
  ko: "Korean",
  ja: "Japanese",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

const DEV = Deno.env.get("SUPABASE_ENV") !== "production" && Deno.env.get("ENVIRONMENT") !== "production";
function devLog(event: string, fields: Record<string, unknown> = {}) {
  if (DEV) console.log(`[translate-caddie-analysis] ${event}`, fields);
}

// Only the free-text surface — camera_angle, phases, confidence enums, and
// score points are structural/factual and stay exactly as originally
// analyzed. A per-field language reminder in each STRING property's own
// `description` (not just the system instruction) is what actually made
// analyze-swing's own translation reliable — same approach here.
function buildTranslationSchema(localeName: string) {
  const reasonOnly = {
    type: "OBJECT",
    properties: { reason: { type: "STRING", description: `Write in ${localeName}.` } },
    required: ["reason"],
  };
  return {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING", description: `Write in ${localeName}.` },
      strengths: { type: "ARRAY", items: { type: "STRING" }, description: `Write each in ${localeName}.` },
      work_on: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            issue: { type: "STRING", description: `Write in ${localeName}.` },
            why_it_matters: { type: "STRING", description: `Write in ${localeName}.` },
          },
          required: ["issue", "why_it_matters"],
        },
      },
      focus: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: `Write in ${localeName}.` },
          instruction: { type: "STRING", description: `Write in ${localeName}.` },
        },
        required: ["title", "instruction"],
      },
      drill: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: `Write in ${localeName}.` },
          steps: { type: "ARRAY", items: { type: "STRING" }, description: `Write each step in ${localeName}.` },
        },
        required: ["name", "steps"],
      },
      limitations: { type: "ARRAY", items: { type: "STRING" }, description: `Write each in ${localeName}.` },
      score: {
        type: "OBJECT",
        properties: {
          setup_and_posture: reasonOnly,
          backswing: reasonOnly,
          downswing_sequencing: reasonOnly,
          balance_and_weight_transfer: reasonOnly,
          finish: reasonOnly,
        },
        required: ["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"],
      },
    },
    required: ["summary", "strengths", "work_on", "focus", "drill", "limitations", "score"],
  };
}

interface RequestBody {
  analysisId?: string;
  locale?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error("[translate-caddie-analysis] GEMINI_API_KEY is not configured.");
    return jsonResponse({ error: "Translation isn't configured yet. Please try again later." }, 500);
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
  if (!body.analysisId || typeof body.analysisId !== "string") return jsonResponse({ error: "analysisId is required." }, 400);
  if (!body.locale || !SUPPORTED_LOCALES.has(body.locale)) return jsonResponse({ error: "A supported locale is required." }, 400);
  const localeName = LOCALE_NAMES[body.locale];

  // RLS (owner-only select on caddie_analyses) already scopes this to the
  // caller's own row — no separate ownership check needed.
  const { data: row, error: fetchError } = await supabase.from("caddie_analyses").select("*").eq("id", body.analysisId).single();
  if (fetchError || !row) return jsonResponse({ error: "Analysis not found." }, 404);
  if (row.status !== "complete" || !row.analysis_json) {
    return jsonResponse({ error: "This analysis isn't ready to translate yet." }, 400);
  }

  const lastUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  if (lastUpdatedAt && Date.now() - lastUpdatedAt < COOLDOWN_SECONDS * 1000) {
    return jsonResponse({ error: "Please wait a moment before translating again." }, 429);
  }

  const source = row.analysis_json as Record<string, unknown>;
  const sourceScore = (source.score as Record<string, { points: number; reason: string }>) ?? {};
  const translationInput = {
    summary: source.summary,
    strengths: source.strengths,
    work_on: Array.isArray(source.work_on) ? (source.work_on as { issue: string; why_it_matters: string }[]).map((w) => ({ issue: w.issue, why_it_matters: w.why_it_matters })) : [],
    focus: source.focus,
    drill: source.drill,
    limitations: source.limitations,
    score: Object.fromEntries(Object.entries(sourceScore).map(([k, v]) => [k, { reason: v.reason }])),
  };

  try {
    const genRes = await fetch(`${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `You are a translation assistant for GolfMe Caddie, a golf swing feedback app. Translate ONLY the free-text fields of the given JSON into ${localeName} — a faithful, natural translation, not a rewrite. Never add, remove, or alter any factual claim, number, or the JSON's structure. Preserve the exact same field names. Every string value in your output must be in ${localeName}.`,
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: `Translate this JSON's free-text fields into ${localeName}: ${JSON.stringify(translationInput)}` }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: buildTranslationSchema(localeName) },
      }),
    });
    if (!genRes.ok) {
      const errBody = await genRes.text().catch(() => "");
      console.error("[translate-caddie-analysis] Gemini call failed.", { status: genRes.status, body: errBody.slice(0, 500) });
      return jsonResponse({ error: "Caddie couldn't translate this analysis. Please try again." }, 502);
    }
    const genBody = await genRes.json();
    const text = genBody?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return jsonResponse({ error: "Caddie couldn't translate this analysis. Please try again." }, 502);
    const translated = JSON.parse(text) as {
      summary: string;
      strengths: string[];
      work_on: { issue: string; why_it_matters: string }[];
      focus: { title: string; instruction: string };
      drill: { name: string; steps: string[] };
      limitations: string[];
      score: Record<string, { reason: string }>;
    };

    // Merge translated prose back over the original analysis_json —
    // camera_angle, phases, per-item confidence, and score points are
    // copied through unchanged from the original.
    const originalWorkOn = Array.isArray(source.work_on) ? (source.work_on as { confidence: string }[]) : [];
    const mergedWorkOn = translated.work_on.map((w, i) => ({ ...w, confidence: originalWorkOn[i]?.confidence ?? "medium" }));
    const mergedScore = Object.fromEntries(
      Object.entries(sourceScore).map(([k, v]) => [k, { points: v.points, reason: translated.score[k]?.reason ?? v.reason }]),
    );
    const mergedJson = {
      ...source,
      summary: translated.summary,
      strengths: translated.strengths,
      work_on: mergedWorkOn,
      focus: translated.focus,
      drill: translated.drill,
      limitations: translated.limitations,
      score: mergedScore,
    };

    const { data: updated, error: updateError } = await supabase
      .from("caddie_analyses")
      .update({
        analysis_json: mergedJson,
        analysis_summary: translated.summary,
        strengths: translated.strengths.slice(0, 3),
        issues: mergedWorkOn.map((w) => w.issue),
        recommendations: mergedWorkOn.map((w) => w.why_it_matters),
        drills: translated.drill?.name ? [translated.drill.name] : [],
      })
      .eq("id", row.id)
      .select()
      .single();
    if (updateError || !updated) {
      console.error("[translate-caddie-analysis] save failed.", { rowId: row.id, reason: updateError?.message });
      return jsonResponse({ error: "Translated, but saving it failed. Please try again." }, 500);
    }
    devLog("translated", { id: row.id, locale: body.locale });
    return jsonResponse({ analysis: updated }, 200);
  } catch (err) {
    console.error("[translate-caddie-analysis] threw.", err);
    return jsonResponse({ error: "Caddie couldn't translate this analysis. Please try again." }, 500);
  }
});
