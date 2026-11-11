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
import { consumeRequestBudget, budgetResponse } from "../_shared/requestBudget.ts";
import { COURSE_FILTER_VERSION, geoapifyCourseName, rejectGeoapifyCourse } from "../_shared/courseFilter.ts";
import {
  cleanQuery,
  geocodeAmenityUrl,
  geocodeResultToCourse,
  mergeCourseCandidates,
  placeAutocompleteUrl,
  placesByNameUrl,
  toPlaceResults,
} from "../_shared/geoapifySearch.ts";
import type { CourseCandidate, GeocodeResult } from "../_shared/geoapifySearch.ts";

interface RequestBody {
  // "place": a typed area (town, neighbourhood, zip) -> coarse coordinates.
  mode: "search" | "nearby" | "place";
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
    categories?: string[];
    datasource?: { raw?: Record<string, unknown> };
  };
}

// Confirmed against Geoapify's live category list — "sport.golf" (the
// original Phase 3 value) doesn't exist and was never caught until now,
// since GEOAPIFY_API_KEY was never set until 2026-08-16, meaning this
// endpoint was never actually called successfully before today.
const GEOAPIFY_CATEGORY = "sport.golf_course";
// Most courses one nearby request returns (the course map's pins).
const NEARBY_MAX = 100;
const UPSERT_BATCH = 10;

// Same CORS preflight issue as delete-account: without an explicit OPTIONS
// response and Access-Control-Allow-* headers, the browser's preflight for
// this cross-origin POST never succeeds, so the real request is never sent.
//
// x-client-info specifically: supabase-js's DEFAULT_HEADERS puts this on
// every request its FunctionsClient sends (see
// @supabase/supabase-js/src/lib/constants.ts), including real
// supabase.functions.invoke() calls -- a raw fetch() built by hand (what
// every curl/Playwright test used while diagnosing this) never sends it,
// so testing never caught that the browser's real preflight was rejecting
// this header and silently blocking the actual POST client-side (surfaces
// as supabase-js's FunctionsFetchError, "Failed to send a request to the
// Edge Function" -- a network-layer failure, not an HTTP error response).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// One Geoapify GET. Errors come back as values so a search can still use
// the other provider's answer.
async function fetchGeoapify<T>(url: string): Promise<{ body: T } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // Fetch errors can include the URL and its provider API key.
    return { error: "Could not reach course search provider." };
  }
  if (!res.ok) {
    // Provider bodies can echo keyed URLs. Return only the safe HTTP status.
    return { error: "Course search provider returned an error (" + res.status + ")." };
  }
  try {
    return { body: (await res.json()) as T };
  } catch {
    return { error: "Course search provider returned an unreadable response." };
  }
}

// Only real, playable, named courses are cached or returned: no unnamed
// features (never a street address as the name), no miniature golf, no
// driving ranges/simulators (see _shared/courseFilter.ts).
function placesFeatures(features: GeoapifyFeature[] | undefined): CourseCandidate[] {
  return (features ?? [])
    .filter((f) => f.properties?.place_id && f.properties.lat != null && f.properties.lon != null)
    .filter((f) => rejectGeoapifyCourse(f.properties) === null)
    .map((f) => ({ ...f.properties }));
}

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

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  // Verify a real account before ANY Geoapify call, including place-only
  // results. A valid public anon key at the gateway is not a signed-in user.
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.is_anonymous) return jsonResponse({ error: "Not authenticated." }, 401);
  const limited = budgetResponse(await consumeRequestBudget(supabase, "course-search"), corsHeaders);
  if (limited) return limited;

  // Nearby goes up to 100 for the course map (Micky, 2026-11-04: "way more
  // pins"); search stays at 20.
  const limit = Math.min(body.limit ?? 10, body.mode === "nearby" ? NEARBY_MAX : 20);
  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : undefined;
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : undefined;

  // Place search: coordinates for a typed area. Returns rounded points and
  // labels only; nothing is cached or written.
  if (body.mode === "place") {
    const query = cleanQuery(body.query);
    if (query.length < 2) return jsonResponse({ error: "query required for place search." }, 400);
    const res = await fetchGeoapify<{ results?: GeocodeResult[] }>(placeAutocompleteUrl(apiKey, query, lat, lng));
    if ("error" in res) return jsonResponse({ error: res.error }, 502);
    return jsonResponse({ places: toPlaceResults(res.body.results ?? []) });
  }

  let candidates: CourseCandidate[];
  if (body.mode === "nearby") {
    if (lat == null || lng == null) return jsonResponse({ error: "lat/lng required for nearby search." }, 400);
    // Ask Geoapify for at least 20 (one credit covers up to 20 places) so
    // the list is still full after unnamed features, ranges and mini golf
    // are dropped below; the response is cut back to `limit`. A map-sized
    // request asks for a little more than it needs for the same reason.
    const fetchCount = limit <= 20 ? 20 : Math.min(Math.ceil(limit * 1.2), NEARBY_MAX + 20);
    const params = new URLSearchParams({ categories: GEOAPIFY_CATEGORY, limit: String(fetchCount), apiKey });
    const radiusMeters = Math.round((body.radiusMiles ?? 25) * 1609.34);
    params.set("filter", `circle:${lng},${lat},${radiusMeters}`);
    params.set("bias", `proximity:${lng},${lat}`);
    const res = await fetchGeoapify<{ features?: GeoapifyFeature[] }>(`https://api.geoapify.com/v2/places?${params.toString()}`);
    if ("error" in res) return jsonResponse({ error: res.error }, 502);
    candidates = placesFeatures(res.body.features);
  } else if (body.mode === "search") {
    const query = cleanQuery(body.query);
    if (!query) return jsonResponse({ error: "query required for search." }, 400);
    // A real name search (see _shared/geoapifySearch.ts for why both). The
    // proximity bias still ranks a nearby course above a distant namesake
    // without hiding out-of-area matches. Either provider failing alone is
    // fine; both failing is a real error.
    const [byName, byText] = await Promise.all([
      fetchGeoapify<{ features?: GeoapifyFeature[] }>(placesByNameUrl(apiKey, query, lat, lng)),
      fetchGeoapify<{ results?: GeocodeResult[] }>(geocodeAmenityUrl(apiKey, query, lat, lng)),
    ]);
    if ("error" in byName && "error" in byText) return jsonResponse({ error: byName.error }, 502);
    candidates = mergeCourseCandidates(
      "error" in byName ? [] : placesFeatures(byName.body.features),
      "error" in byText ? [] : (byText.body.results ?? []).map(geocodeResultToCourse).filter((c): c is CourseCandidate => c !== null),
    );
  } else {
    return jsonResponse({ error: "mode must be 'search', 'nearby' or 'place'." }, 400);
  }

  candidates = candidates.slice(0, limit);
  if (candidates.length === 0) return jsonResponse({ results: [], courseFilter: COURSE_FILTER_VERSION });

  // Geoapify is the location-discovery provider -- it's the one of the two
  // real course-data sources that can actually search by coordinates.
  // GolfCourseAPI (course-enrich, a separate on-demand Edge Function) has no
  // location search at all -- it only matches by course/club name -- so it
  // never discovers a course on its own, only enriches one Geoapify already
  // found. upsert_external_course() is what prevents the same physical
  // course from ever getting a second, duplicate courses row if it's later
  // also matched by name in GolfCourseAPI: both providers' mappings point at
  // one canonical courses.id.
  // In batches, in order: a 100-pin map request one call at a time took
  // seconds; a whole batch at once would hit the database all together.
  const upsert = async (c: CourseCandidate) => {
    const name = geoapifyCourseName(c);
    return await supabase.rpc("upsert_external_course", {
      p_provider: "geoapify",
      p_external_id: c.place_id,
      p_name: name,
      p_normalized_name: name.toLowerCase(),
      p_city: c.city ?? null,
      p_region: c.state ?? null,
      p_country: c.country ?? null,
      p_address: c.formatted ?? null,
      p_latitude: c.lat,
      p_longitude: c.lon,
    });
  };
  const results = [];
  for (let i = 0; i < candidates.length; i += UPSERT_BATCH) {
    const batch = await Promise.all(candidates.slice(i, i + UPSERT_BATCH).map(upsert));
    for (const { data, error } of batch) {
      if (error) return jsonResponse({ error: `Failed to cache course results: ${error.message}` }, 500);
      results.push(data);
    }
  }

  return jsonResponse({ results, courseFilter: COURSE_FILTER_VERSION });
});
