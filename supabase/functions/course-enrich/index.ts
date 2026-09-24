// On-demand course-detail enrichment via GolfCourseAPI. The GolfCourseAPI
// key lives only here (a Supabase Edge Function secret, GOLF_COURSE_API_KEY)
// -- never sent to or embedded in the browser bundle, same posture as
// GEOAPIFY_API_KEY in course-search.
//
// GolfCourseAPI has no location search at all -- confirmed live before
// building this (searching "Farmingdale", a real town with real courses,
// returns zero results; searching "New York" only matches a club literally
// named that) -- so it can never be the *discovery* provider. Geoapify
// (course-search) stays responsible for "find courses near this location."
// This function is purely a secondary, best-effort enrichment step: given a
// course GolfMe already knows about (found via Geoapify), try to find the
// same physical course by name in GolfCourseAPI's ~30k-course dataset and
// attach its real hole-count data if a confident match exists. Geoapify
// still owns discovery and still supplies the courses row's initial
// latitude/longitude; a confirmed match's own coordinates (v1.1, optional,
// validated in validCoordinates() below) are preferred over Geoapify's once
// found, since they're specific to the course rather than a general places
// lookup -- but Geoapify's value is never cleared/zeroed when GolfCourseAPI
// doesn't have coordinates for a course, only ever overwritten when a
// better one is confidently available.
//
// Called on-demand (one course_id per request, never a batch over search
// results) because the free tier is 50 requests/day -- calling this for
// every result in a list would burn through that budget on a single search.
// courses.golfcourseapi_checked_at (set by both the match and no-match
// paths, via attach_external_course_mapping()/mark_course_enrichment_checked())
// means a given course is ever checked at most once.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface RequestBody {
  courseId: string;
}

interface GolfCourseApiTeeSet {
  number_of_holes?: number;
}

interface GolfCourseApiCourse {
  id: number | string;
  club_name?: string;
  course_name?: string;
  // latitude/longitude are v1.1 additions (announced 2026), additive and
  // optional per GolfCourseAPI's own changelog -- omitted for some courses,
  // so never assumed present. See scoreMatch()/MATCH_THRESHOLD above this
  // for why location is otherwise only used for city/state cross-checking.
  location?: { city?: string; state?: string; country?: string; latitude?: number; longitude?: number };
  tees?: { male?: GolfCourseApiTeeSet[]; female?: GolfCourseApiTeeSet[] };
}

// v1.1 coordinates are optional and provider-supplied -- never trust them
// without checking they're real, finite numbers in valid lat/lng ranges.
// Failing silently (return null, no error) matches this function's existing
// "best-effort enrichment, never something a caller should see an error
// for" posture (see enrichRealCourse() in realCourseSearch.ts).
function validCoordinates(lat: unknown, lng: unknown): { latitude: number; longitude: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

// x-client-info is sent on every real supabase.functions.invoke() call by
// supabase-js's DEFAULT_HEADERS -- omitting it here would make a real
// browser's CORS preflight reject the actual request client-side (a true
// network failure, not an HTTP error status), the same bug found and fixed
// in course-search's identical corsHeaders block.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Multi-course-facility guard (2026-09-18, real nearby-course-data-accuracy
// pass): a shared facility name ("Bethpage", "Van Cortlandt") plus generic
// filler words ("Golf", "Course", "State", "Park") can clear the overall
// word-overlap threshold below even when comparing two DIFFERENT courses at
// the same facility -- "Bethpage Black Course" vs a candidate "Bethpage Red
// Course" -- because neither name is long enough for one mismatched word to
// pull the ratio down far. A color/direction/number token is exactly the
// word golf facilities use to distinguish their own courses from each
// other, so when BOTH names specify one, they must agree.
const DISTINGUISHING_WORDS = new Set(["black", "red", "blue", "green", "gold", "white", "yellow", "orange", "silver", "bronze", "north", "south", "east", "west"]);
function distinguishingTokens(name: string): Set<string> {
  const found = new Set<string>();
  for (const t of normalize(name).split(" ")) {
    if (DISTINGUISHING_WORDS.has(t) || /^\d+$/.test(t)) found.add(t);
  }
  return found;
}

// Deliberately conservative: GolfCourseAPI's search only matches against
// club_name (appending extra words like a tee/nine name to the query
// reliably returns zero results, confirmed live), so candidates are fetched
// broadly by a short query and narrowed here by actually comparing names --
// not trusted to have already narrowed correctly. A match requires BOTH
// meaningful word overlap in the name AND a city/state cross-check when
// GolfMe has that data, so a same-named course in a different state/country
// (a large real risk across a 30k-course global dataset) doesn't get
// silently attached to the wrong physical course.
function scoreMatch(golfMeName: string, golfMeCity: string | null, golfMeRegion: string | null, candidate: GolfCourseApiCourse): number {
  const candidateName = normalize(`${candidate.club_name ?? ""} ${candidate.course_name ?? ""}`);

  // Reject outright, regardless of overlap, when both names specify a
  // distinguishing token and they don't share one -- see comment above.
  // Only fires when BOTH sides actually name one; a facility-only name on
  // either side ("Bethpage State Park" with no color) stays ambiguous
  // rather than being hard-rejected, since that's a real, common case of
  // an imprecise name, not evidence of a wrong course.
  const golfMeDistinguishing = distinguishingTokens(golfMeName);
  const candidateDistinguishing = distinguishingTokens(candidateName);
  if (golfMeDistinguishing.size > 0 && candidateDistinguishing.size > 0) {
    const sharesDistinguishing = [...golfMeDistinguishing].some((t) => candidateDistinguishing.has(t));
    if (!sharesDistinguishing) return 0;
  }

  const golfMeTokens = normalize(golfMeName).split(" ").filter((t) => t.length > 2);
  if (golfMeTokens.length === 0) return 0;
  const overlap = golfMeTokens.filter((t) => candidateName.includes(t)).length / golfMeTokens.length;

  const cityMatch = golfMeCity ? normalize(candidate.location?.city ?? "") === normalize(golfMeCity) : false;
  const regionMatch = golfMeRegion ? normalize(candidate.location?.state ?? "") === normalize(golfMeRegion) : false;
  const hasLocationData = Boolean(golfMeCity || golfMeRegion);

  if (hasLocationData) {
    if (!cityMatch && !regionMatch) return 0; // never attach across a location mismatch
    return overlap;
  }
  // No location on file to cross-check -- require a much stronger name match.
  return overlap >= 0.99 ? overlap : 0;
}

const MATCH_THRESHOLD = 0.5;

// Real nearby-course-data-accuracy pass, same date: independent of the
// name match above, cross-check the two providers' own coordinates when
// both are available. A great name-overlap score can still be the WRONG
// course (a same-named course in a different part of a large city that
// slipped past the city/state check, or two courses at one facility that
// happened to share their one distinguishing word) -- coordinates that
// are implausibly far apart are strong independent evidence of exactly
// that, so this REJECTS the match outright rather than just lowering a
// confidence label GolfMe doesn't display anywhere yet.
//
// Threshold rationale (not arbitrary, no labeled ground truth to tune
// against yet -- flagged as a starting point, not a validated constant):
// even a large multi-course facility (Bethpage's full ~1500 acres) rarely
// spans a mile end-to-end, and two different providers geocoding the same
// clubhouse/entrance typically land well under a quarter mile apart in
// practice. 1 mile leaves real margin for ordinary geocoding variance
// (clubhouse vs. parking lot vs. a specific hole) while still catching a
// genuine wrong-course match, which is typically many miles away.
const COORD_DISAGREEMENT_REJECT_MILES = 1;
const EARTH_RADIUS_MILES = 3958.8;
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("GOLF_COURSE_API_KEY");
  if (!apiKey) return jsonResponse({ error: "Course enrichment isn't configured yet (missing GOLF_COURSE_API_KEY)." }, 503);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  if (!body.courseId) return jsonResponse({ error: "courseId is required." }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, name, city, region, holes, golfcourseapi_checked_at, latitude, longitude")
    .eq("id", body.courseId)
    .maybeSingle();
  if (courseError) return jsonResponse({ error: courseError.message }, 500);
  if (!course) return jsonResponse({ error: "Course not found." }, 404);

  if (course.golfcourseapi_checked_at) {
    // Already resolved (matched or genuinely not found in GolfCourseAPI) --
    // never re-spend quota re-checking the same course.
    return jsonResponse({ matched: Boolean(course.holes), course });
  }

  // GolfCourseAPI's search only reliably matches a short query against
  // club_name -- try the full name first, fall back to just its first word.
  const nameTokens = course.name.trim().split(/\s+/);
  const queries = [course.name.trim(), nameTokens[0]].filter((q, i, arr) => q && arr.indexOf(q) === i);

  let candidates: GolfCourseApiCourse[] = [];
  for (const q of queries) {
    let res: Response;
    try {
      res = await fetch(`https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Key ${apiKey}` },
      });
    } catch (err) {
      return jsonResponse({ error: `Could not reach GolfCourseAPI: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    if (!res.ok) return jsonResponse({ error: `GolfCourseAPI returned an error (${res.status}).` }, 502);
    const resBody = (await res.json()) as { courses?: GolfCourseApiCourse[] };
    candidates = resBody.courses ?? [];
    if (candidates.length > 0) break;
  }

  let best: { candidate: GolfCourseApiCourse; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreMatch(course.name, course.city, course.region, candidate);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { candidate, score };
  }

  // Coordinate cross-validation, independent of the name score above --
  // see COORD_DISAGREEMENT_REJECT_MILES's own comment. Only runs when
  // GolfCourseAPI actually provided coordinates for the matched candidate
  // (v1.1, optional) -- courses.latitude/longitude are always real
  // (NOT NULL, always Geoapify-sourced by this point since enrichment only
  // ever runs on an already-discovered course), so this never has to
  // guess at GolfMe's own side of the comparison.
  if (best) {
    const candidateCoords = validCoordinates(best.candidate.location?.latitude, best.candidate.location?.longitude);
    if (candidateCoords && typeof course.latitude === "number" && typeof course.longitude === "number") {
      const distanceMiles = haversineMiles(course.latitude, course.longitude, candidateCoords.latitude, candidateCoords.longitude);
      if (distanceMiles > COORD_DISAGREEMENT_REJECT_MILES) best = null;
    }
  }

  if (!best) {
    const { error: markError } = await supabase.rpc("mark_course_enrichment_checked", { p_course_id: course.id });
    if (markError) return jsonResponse({ error: markError.message }, 500);
    return jsonResponse({ matched: false, course });
  }

  const teeSet = best.candidate.tees?.male?.[0] ?? best.candidate.tees?.female?.[0];
  // GolfCourseAPI coordinates are preferred over Geoapify's when valid --
  // GolfCourseAPI's data is course-specific and hand-curated, vs. Geoapify's
  // general places-API geocoding, which can land on a clubhouse/parking lot
  // rather than the actual course. They're passed into
  // attach_external_course_mapping() itself (health audit Batch C, P2-4:
  // courses no longer has a direct client-JWT write policy), which applies
  // them to whichever course the mapping actually landed on -- that RPC can
  // return a DIFFERENT canonical course than the caller's own if this
  // GolfCourseAPI id was already mapped elsewhere, and coordinates belong on
  // that course, same as `holes`. Missing/invalid coordinates are passed as
  // null and simply leave Geoapify's existing values in place -- the
  // fallback is "do nothing," never a fabricated or zeroed value, and never
  // a user-facing error just because a provider didn't have coordinates.
  const coords = validCoordinates(best.candidate.location?.latitude, best.candidate.location?.longitude);
  const { data: updated, error: attachError } = await supabase.rpc("attach_external_course_mapping", {
    p_course_id: course.id,
    p_provider: "golfcourseapi",
    p_external_id: String(best.candidate.id),
    p_holes: teeSet?.number_of_holes ?? null,
    p_latitude: coords?.latitude ?? null,
    p_longitude: coords?.longitude ?? null,
  });
  if (attachError) return jsonResponse({ error: attachError.message }, 500);

  return jsonResponse({ matched: true, course: updated });
});
