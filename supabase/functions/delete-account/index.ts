// Real account deletion. The service-role key never reaches the browser —
// it's a Supabase-managed secret injected into every Edge Function's
// environment automatically, same posture as the Geoapify key in
// course-search: held server-side only, never a VITE_ client env var.
//
// The account to delete is always the CALLER's own — derived from their
// verified JWT via auth.getUser(), never a client-supplied id — so this
// function can only ever delete the account making the request, nothing
// else. verify_jwt (the gateway-level setting on this function) means an
// unauthenticated request never reaches this code at all.
//
// auth.users cascades (on delete cascade) through every table this project
// has that references a user: profiles, golf_calls (as host), round_
// participants, conversation_participants, messages, blocks, notifications,
// round_reviews. reports.reported_user_id is `on delete set null` instead —
// a report survives the reported person's deletion, on purpose, as a
// moderation record. Known, accepted beta-scope limitation: if a host
// deletes their account, their hosted round (and every other golfer's
// participation in it) cascades away too — no "orphan to a new host" logic
// exists yet.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Browsers preflight any cross-origin request that carries custom headers
// (Authorization, apikey) with an OPTIONS request before the real one —
// without an explicit response to that OPTIONS request, the browser never
// sends the actual POST at all and every client-side caller sees an opaque
// "Failed to fetch", no matter how correct the POST handler itself is. This
// was caught live (a real browser fetch, not curl, which never triggers a
// preflight) before ever being reported as done.
//
// x-client-info: supabase-js's FunctionsClient sends this on every real
// supabase.functions.invoke() call (DEFAULT_HEADERS in
// @supabase/supabase-js/src/lib/constants.ts). It was missing from this
// allow-list too -- meaning even after the original CORS fix above, a real
// browser call from the actual app would still have been silently blocked
// client-side by the preflight (FunctionsFetchError, "Failed to send a
// request to the Edge Function"), never caught because every test used a
// hand-built fetch() that never sent this header. Found via the same bug
// surfacing in course-search.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser();

  if (userError || !user) return jsonResponse({ error: "Not authenticated." }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteError) return jsonResponse({ error: deleteError.message }, 500);

  return jsonResponse({ success: true });
});
