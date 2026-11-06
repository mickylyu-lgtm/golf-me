// Removes orphaned chat-media files: photos and voice messages that no
// message row points at any more (unsent, the row deleted, or an upload
// whose row never got inserted), older than 24 hours. The app deletes the
// file itself right after an unsend; this is the server-side backstop for
// when that delete fails (offline, app killed), so the Privacy Policy's
// "its file is deleted" holds either way.
//
// Never called by the app. The only caller is the pg_cron job
// 'golfme-sweep-chat-media' (hourly, migration 20261107240000) through
// pg_net, authenticated with the same shared secret send-push uses (Vault
// 'push_internal_secret' = function secret PUSH_INTERNAL_SECRET), so this is
// deployed with verify_jwt disabled and checks the header itself:
//   supabase functions deploy chat-media-sweep --no-verify-jwt
//
// Which files: public.chat_media_orphans (service role only) decides, in
// SQL, using the same "a row points at it" rule as the bucket's own delete
// policy; files a row still points at (including reported ones) are never
// listed. SQL can't delete Storage files (storage.protect_delete), hence the
// Storage API here. Logs counts only, never paths.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "chat-media";
const LIST_LIMIT = 1000;
const REMOVE_BATCH_SIZE = 100;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A set of text comes back as plain strings; older PostgREST wrapped each
 * as { chat_media_orphans: "..." }. Accept both (as delete-account does). */
export function orphanPaths(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? Object.values(p as Record<string, unknown>)[0] : null))
    .filter((p): p is string => typeof p === "string" && /^(dm|round)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|m4a|webm)$/.test(p));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (!internalSecret) {
    console.error("chat-media-sweep: PUSH_INTERNAL_SECRET is not set; every sweep is rejected.");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("chat-media-sweep: x-internal-secret header does not match PUSH_INTERNAL_SECRET.");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await client.rpc("chat_media_orphans", { p_limit: LIST_LIMIT });
  if (error) {
    console.error("chat-media-sweep: listing failed", { message: error.message });
    return jsonResponse({ error: "list_failed" }, 500);
  }

  const paths = orphanPaths(data);
  let removed = 0;
  let failedBatches = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error: removeError } = await client.storage.from(BUCKET).remove(batch);
    if (removeError) {
      failedBatches += 1;
      console.error("chat-media-sweep: remove failed", { files: batch.length, message: removeError.message });
    } else {
      removed += batch.length;
    }
  }

  const outcome = { listed: paths.length, removed, failed_batches: failedBatches };
  console.log("chat-media-sweep", outcome);
  return jsonResponse(outcome, failedBatches > 0 ? 207 : 200);
});
