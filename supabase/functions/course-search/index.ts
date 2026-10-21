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
import {
  geoapifyAutocompleteParams,
  geoapifyPlaceDetailsParams,
  geoapifyRawPlaceId,
  geocodeCacheKey,
  mapGeoapifyPlaceDetails,
  mapGeoapifyResults,
  sanitizeCityPlaces,
  sanitizePlaceNamesDto,
  validateGeocodeRequest,
} from "../_shared/cityGeocode.ts";
import type { CityPlaceDto } from "../_shared/cityGeocode.ts";

interface RequestBody {
  mode: "search" | "nearby" | "geocode" | "place";
  query?: string;
  placeId?: string;
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

// Confirmed against Geoapify's live category list — "sport.golf" (the
// original Phase 3 value) doesn't exist and was never caught until now,
// since GEOAPIFY_API_KEY was never set until 2026-08-16, meaning this
// endpoint was never actually called successfully before today.
const GEOAPIFY_CATEGORY = "sport.golf_course";

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

  if (body.mode === "geocode") return handleGeocode(req, body, apiKey);
  if (body.mode === "place") return handlePlaceNames(req, body, apiKey);

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
    return jsonResponse({ error: "mode must be 'search', 'nearby', 'geocode' or 'place'." }, 400);
  }

  let geoapifyRes: Response;
  try {
    geoapifyRes = await fetch(`https://api.geoapify.com/v2/places?${params.toString()}`);
  } catch (err) {
    return jsonResponse({ error: `Could not reach course search provider: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  if (!geoapifyRes.ok) {
    const detail = await geoapifyRes.text().catch(() => "");
    return jsonResponse({ error: `Course search provider returned an error (${geoapifyRes.status}): ${detail}` }, 502);
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

// ---------------------------------------------------------------------------
// mode: "geocode" -- worldwide city autocomplete for the playing-area picker
// (global hosting Phase 2). Geoapify Address Autocomplete with type=city;
// one request = 1 Geoapify credit, shared with course search's daily
// allowance, so every request goes through, in order:
//   1. input validation (min 3 chars, 2 for CJK; max 80; lang allow-list);
//   2. consume_geocode_quota() with the CALLER's JWT -- per-user 60/hour and
//      200/day, global 2000/day. Fails closed: if the RPC is missing (the
//      migration isn't applied yet) or errors, the request is refused and the
//      client falls back to the built-in city list;
//   3. a per-isolate memo (cheap repeat hits while one user types);
//   4. the shared 30-day DB cache (private.geocode_cache, service_role only);
//   5. Geoapify, whose results are coarsened to 2 dp before they are cached
//      or returned.
// Never logs the query text or any coordinate.
// ---------------------------------------------------------------------------

const GEOCODE_MEMO_TTL_MS = 60 * 60 * 1000;
const GEOCODE_MEMO_MAX = 200;
const geocodeMemo = new Map<string, { at: number; results: CityPlaceDto[] }>();

function memoGet(key: string): CityPlaceDto[] | undefined {
  const hit = geocodeMemo.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > GEOCODE_MEMO_TTL_MS) {
    geocodeMemo.delete(key);
    return undefined;
  }
  return hit.results;
}

function memoSet(key: string, results: CityPlaceDto[]): void {
  if (geocodeMemo.size >= GEOCODE_MEMO_MAX) {
    const oldest = geocodeMemo.keys().next().value;
    if (oldest !== undefined) geocodeMemo.delete(oldest);
  }
  geocodeMemo.set(key, { at: Date.now(), results });
}

// Spends `cost` Geoapify credits from the CALLER's quota (auth.uid() inside
// the RPC, never a parameter). Returns an error response, or null when the
// request may go ahead. Fails closed: a missing RPC (migration not applied)
// or any error refuses the request and the client falls back.
async function consumeGeocodeQuota(req: Request, cost: number): Promise<Response | null> {
  const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: quota, error: quotaError } = await callerClient.rpc("consume_geocode_quota", { p_cost: cost });
  if (quotaError) {
    console.error("course-search geocode: quota check failed", quotaError.code ?? "");
    return jsonResponse({ error: "City search is temporarily unavailable.", code: "unavailable" }, 503);
  }
  if (quota === "unauthenticated") return jsonResponse({ error: "Sign in to search cities.", code: "unauthenticated" }, 401);
  if (quota === "user_limit") return jsonResponse({ error: "Too many city searches. Try again later.", code: "rate_limited" }, 429);
  if (quota !== "ok") return jsonResponse({ error: "City search is busy right now.", code: "quota_exhausted" }, 429);
  return null;
}

async function handleGeocode(req: Request, body: RequestBody, apiKey: string): Promise<Response> {
  const validation = validateGeocodeRequest(body);
  if (!validation.ok) return jsonResponse({ error: validation.error, code: "invalid" }, 400);
  const geoReq = validation.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const denied = await consumeGeocodeQuota(req, 1);
  if (denied) return denied;

  const key = await geocodeCacheKey(geoReq);
  const memo = memoGet(key);
  if (memo) return jsonResponse({ results: memo, cached: true });

  // Service-role client for the cache only. Missing key = no shared cache,
  // still correct (memo + quota still apply).
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminClient = serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null;

  if (adminClient) {
    const { data: cached, error: cacheError } = await adminClient.rpc("geocode_cache_get", { p_key: key });
    if (cacheError) console.error("course-search geocode: cache read failed", cacheError.code ?? "");
    else if (Array.isArray(cached)) {
      const results = sanitizeCityPlaces(cached);
      memoSet(key, results);
      return jsonResponse({ results, cached: true });
    }
  }

  const params = geoapifyAutocompleteParams(geoReq);
  params.set("apiKey", apiKey);
  let geoRes: Response;
  try {
    geoRes = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`);
  } catch {
    return jsonResponse({ error: "Could not reach the city search provider.", code: "provider_unreachable" }, 502);
  }
  if (!geoRes.ok) {
    // Status only: the provider's error body is never echoed to clients.
    console.error("course-search geocode: provider error", geoRes.status);
    const code = geoRes.status === 429 || geoRes.status === 402 ? "quota_exhausted" : "provider_error";
    return jsonResponse({ error: "City search provider returned an error.", code }, 502);
  }

  const geoBody = (await geoRes.json().catch(() => null)) as { results?: unknown } | null;
  const results = mapGeoapifyResults(geoBody?.results);
  memoSet(key, results);

  if (adminClient) {
    const { error: putError } = await adminClient.rpc("geocode_cache_put", { p_key: key, p_results: results });
    if (putError) console.error("course-search geocode: cache write failed", putError.code ?? "");
  }

  return jsonResponse({ results });
}

// ---------------------------------------------------------------------------
// mode: "place" -- a picked city's name in GolfMe's six languages, stored
// once per place in public.geo_places (never per user). The client calls it
// only after a direct geo_places read missed, right after the golfer picks a
// geocoded city. Order: validate the id -> quota (2 credits: Place Details +
// details.names) -> geo_places re-check (a concurrent pick may have filled
// it) -> Geoapify -> upsert. Needs the service-role client: without it the
// names can't be stored, so the request is refused before spending credits.
// Returns names only, never coordinates.
// ---------------------------------------------------------------------------

async function handlePlaceNames(req: Request, body: RequestBody, apiKey: string): Promise<Response> {
  const placeId = typeof body.placeId === "string" ? body.placeId : "";
  const rawId = geoapifyRawPlaceId(placeId);
  if (!rawId) return jsonResponse({ error: "Invalid placeId.", code: "invalid" }, 400);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return jsonResponse({ error: "City names are temporarily unavailable.", code: "unavailable" }, 503);
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });

  const denied = await consumeGeocodeQuota(req, 2);
  if (denied) return denied;

  const { data: existing, error: readError } = await adminClient
    .from("geo_places")
    .select("place_id, names, country_code, region_code")
    .eq("place_id", placeId)
    .maybeSingle();
  if (readError) {
    console.error("course-search place: cache read failed", readError.code ?? "");
    return jsonResponse({ error: "City names are temporarily unavailable.", code: "unavailable" }, 503);
  }
  const cachedDto = sanitizePlaceNamesDto(existing);
  if (cachedDto) return jsonResponse({ place: cachedDto, cached: true });

  const params = geoapifyPlaceDetailsParams(rawId);
  params.set("apiKey", apiKey);
  let geoRes: Response;
  try {
    geoRes = await fetch(`https://api.geoapify.com/v2/place-details?${params.toString()}`);
  } catch {
    return jsonResponse({ error: "Could not reach the city search provider.", code: "provider_unreachable" }, 502);
  }
  if (!geoRes.ok) {
    console.error("course-search place: provider error", geoRes.status);
    const code = geoRes.status === 429 || geoRes.status === 402 ? "quota_exhausted" : "provider_error";
    return jsonResponse({ error: "City search provider returned an error.", code }, 502);
  }

  const dto = mapGeoapifyPlaceDetails(await geoRes.json().catch(() => null), placeId);
  if (!dto) return jsonResponse({ error: "No names for this city.", code: "not_found" }, 404);

  const { error: putError } = await adminClient.from("geo_places").upsert({
    place_id: dto.placeId,
    names: dto.names,
    country_code: dto.countryCode,
    region_code: dto.regionCode,
    fetched_at: new Date().toISOString(),
  });
  if (putError) console.error("course-search place: cache write failed", putError.code ?? "");

  return jsonResponse({ place: dto });
}
