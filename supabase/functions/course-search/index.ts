// Real course search, server-side. The Geoapify API key lives only here
// (a Supabase Edge Function secret, GEOAPIFY_API_KEY) — it is never sent to
// or embedded in the browser bundle. Demo mode never calls this function at
// all; it's only reached by real (non-demo), authenticated accounts.
//
// Geoapify is the location-discovery half of GolfMe's two-provider course
// architecture (see course-enrich for the GolfCourseAPI name-based detail
// half) — it's the one that can actually search by coordinates.
//
// Uses the caller's own forwarded JWT (not a service-role key) to call
// upsert_external_course(), a SECURITY DEFINER RPC that's the only
// sanctioned write path into courses/course_external_ids — same reasoning
// as join_golf_call() for round_participants: the find-or-create-by-
// (provider, external_id) check and the write happen atomically in one
// transaction, so no caller can create a duplicate canonical course row.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface RequestBody {
  mode: "search" | "nearby";
  query?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  limit?: number;
}

interface GeoapifyFeature {
  properties: {
    place_id: string;
    name?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    country?: string;
    formatted?: string;
    lat: number;
    lon: number;
  };
}

const GEOAPIFY_CATEGORY = "sport.golf";

// Same CORS preflight issue as delete-account: without an explicit OPTIONS
// response and Access-Control-Allow-* headers, the browser's preflight for
// this cross-origin POST never succeeds, so the real request is never sent.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("GEOAPIFY_API_KEY");
  if (!apiKey) {
    // Real, honest failure — never a silent fallback to fake data. The
    // client surfaces this as a retry-able error state.
    return jsonResponse({ error: "Course search isn't configured yet (missing GEOAPIFY_API_KEY)." }, 503);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const limit = Math.min(body.limit ?? 10, 20);
  const params = new URLSearchParams({
    categories: GEOAPIFY_CATEGORY,
    limit: String(limit),
    apiKey,
  });

  if (body.mode === "nearby") {
    if (body.lat == null || body.lng == null) return jsonResponse({ error: "lat/lng required for nearby search." }, 400);
    const radiusMeters = Math.round((body.radiusMiles ?? 25) * 1609.34);
    params.set("filter", `circle:${body.lng},${body.lat},${radiusMeters}`);
    params.set("bias", `proximity:${body.lng},${body.lat}`);
  } else if (body.mode === "search") {
    if (!body.query?.trim()) return jsonResponse({ error: "query required for search." }, 400);
    params.set("text", body.query.trim());
    // Location-aware ranking (nearby result outranks a distant namesake):
    // Geoapify sorts by proximity when a bias is given, even without a hard
    // radius filter, so out-of-area matches still surface, just lower.
    if (body.lat != null && body.lng != null) params.set("bias", `proximity:${body.lng},${body.lat}`);
  } else {
    return jsonResponse({ error: "mode must be 'search' or 'nearby'." }, 400);
  }

  let geoapifyRes: Response;
  try {
    geoapifyRes = await fetch(`https://api.geoapify.com/v2/places?${params.toString()}`);
  } catch (err) {
    return jsonResponse({ error: `Could not reach course search provider: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (!geoapifyRes.ok) {
    return jsonResponse({ error: `Course search provider returned an error (${geoapifyRes.status}).` }, 502);
  }

  const geoapifyBody = (await geoapifyRes.json()) as { features?: GeoapifyFeature[] };
  const features = geoapifyBody.features ?? [];

  const candidates = features.filter((f) => f.properties?.place_id && f.properties.lat != null && f.properties.lon != null);
  if (candidates.length === 0) return jsonResponse({ results: [] });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  // Geoapify is the location-discovery provider -- it's the one of the two
  // real course-data sources that can actually search by coordinates.
  // GolfCourseAPI (course-enrich, a separate on-demand Edge Function) has no
  // location search at all -- it only matches by course/club name -- so it
  // never discovers a course on its own, only enriches one Geoapify already
  // found. upsert_external_course() is what prevents the same physical
  // course from ever getting a second, duplicate courses row if it's later
  // also matched by name in GolfCourseAPI: both providers' mappings point at
  // one canonical courses.id.
  const results = [];
  for (const f of candidates) {
    const name = f.properties.name?.trim() || f.properties.address_line1?.trim() || "Unnamed course";
    const { data, error } = await supabase.rpc("upsert_external_course", {
      p_provider: "geoapify",
      p_external_id: f.properties.place_id,
      p_name: name,
      p_normalized_name: name.toLowerCase(),
      p_city: f.properties.city ?? null,
      p_region: f.properties.state ?? null,
      p_country: f.properties.country ?? null,
      p_address: f.properties.formatted ?? null,
      p_latitude: f.properties.lat,
      p_longitude: f.properties.lon,
    });
    if (error) return jsonResponse({ error: `Failed to cache course results: ${error.message}` }, 500);
    results.push(data);
  }

  return jsonResponse({ results });
});
