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

  // Storage cleanup (Health Audit P2-10). Deleting the auth user cascades
  // every table row, but Storage objects aren't rows Postgres can cascade
  // (and SQL can't delete them -- storage.protect_delete), so the user's
  // avatar, Community/Caddie media and booking-proof files used to stay
  // publicly reachable forever. Every bucket keys objects by the owner's
  // user id as the first path segment (enforced by each bucket's
  // *_insert_own storage policy), so removing `<userId>/` from each bucket
  // removes exactly this user's files and nobody else's.
  //
  // Runs AFTER the auth delete on purpose: if the account delete fails, the
  // user keeps a working account with all their media; if this cleanup
  // fails, the account is still gone (what they asked for) and the leftover
  // files are logged for a manual sweep. Never fails the response.
  const storageCleanup = await purgeUserStorage(adminClient, user.id);
  if (storageCleanup.errors.length > 0) {
    console.error("delete-account: storage cleanup incomplete", { userId: user.id, removed: storageCleanup.removed, errors: storageCleanup.errors });
  }

  return jsonResponse({ success: true });
});

// caddie-media: private Caddie uploads (migration 20260925090000). Listing a
// bucket that doesn't exist yet just lands in `errors` for that bucket;
// the others are still purged.
const USER_KEYED_BUCKETS = ["avatars", "community-media", "booking-proofs", "caddie-media"];
const LIST_PAGE_SIZE = 1000;
const REMOVE_BATCH_SIZE = 100;

type AdminClient = ReturnType<typeof createClient>;

// Recursively collects every object path under `prefix` (Storage's list()
// is one directory level at a time; entries with a null id are folders --
// booking-proofs nests `<userId>/<golfCallId>/<file>`).
async function listAllPaths(client: AdminClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) paths.push(...(await listAllPaths(client, bucket, path, depth + 1)));
      else paths.push(path);
    }
    if (entries.length < LIST_PAGE_SIZE) break;
  }
  return paths;
}

async function purgeUserStorage(client: AdminClient, userId: string): Promise<{ removed: number; errors: string[] }> {
  let removed = 0;
  const errors: string[] = [];
  for (const bucket of USER_KEYED_BUCKETS) {
    try {
      const paths = await listAllPaths(client, bucket, userId);
      for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
        const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
        const { error } = await client.storage.from(bucket).remove(batch);
        if (error) errors.push(`remove ${bucket} (${batch.length} files): ${error.message}`);
        else removed += batch.length;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { removed, errors };
}
