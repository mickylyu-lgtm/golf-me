// Real tee-time retrieval, server-side, for GolfMe's two supported courses
// (Skyway Golf Course, Dyker Beach Golf Course — see
// src/services/teeTimes/types.ts for the canonical course list). This
// function exists so that if/when GolfMe gets real partner-API credentials
// from Lightspeed Golf (Skyway) or Tee It Up/NBC Sports Next (Dyker
// Beach), those secrets live here as Edge Function secrets and never touch
// the client — today it has none, so it honestly returns an empty
// teeTimes array rather than fabricating availability. Demo mode never
// calls this function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface CourseConfig {
  id: string;
  name: string;
  holes: 9 | 18;
  provider: string;
  bookingUrl: string;
}

// Kept in sync by hand with src/services/teeTimes/types.ts and
// src/services/teeTimes/providers/*.ts — Deno Edge Functions don't share a
// bundler with the Vite frontend, so this can't just import that file.
const COURSES: Record<string, CourseConfig> = {
  skyway: {
    id: "skyway",
    name: "Skyway Golf Course at Lincoln Park West",
    holes: 9,
    provider: "lightspeed-golf",
    bookingUrl: "https://www.chronogolf.com/club/skyway-golf-course",
  },
  "dyker-beach": {
    id: "dyker-beach",
    name: "Dyker Beach Golf Course",
    holes: 18,
    provider: "tee-it-up",
    bookingUrl: "https://new-york-american-golf.book.teeitup.com/",
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const courseId = url.searchParams.get("course") ?? "";
  const date = url.searchParams.get("date") ?? "";

  const course = COURSES[courseId];
  if (!course) {
    return jsonResponse({ error: `Unsupported course "${courseId}". Supported: ${Object.keys(COURSES).join(", ")}.` }, 400);
  }
  if (!DATE_RE.test(date)) {
    return jsonResponse({ error: "date must be an ISO date, e.g. 2026-08-25." }, 400);
  }

  // No live provider integration exists yet for either course (see
  // providers/skyway.ts and providers/dykerBeach.ts on the frontend for
  // the full explanation) — honest empty result, never fake times.
  return jsonResponse({
    course: course.id,
    courseName: course.name,
    holes: course.holes,
    date,
    teeTimes: [],
    provider: course.provider,
    bookingUrl: course.bookingUrl,
    liveAvailability: false,
    message: "Live availability isn't connected yet for this course — use \"View Live Tee Times\" to check the official booking site.",
    lastUpdated: new Date().toISOString(),
  });
});
