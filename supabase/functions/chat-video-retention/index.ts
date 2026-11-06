// chat-video-retention Edge Function: wiring only (logic in handler.ts).
// Called once a day by pg_cron (private.request_chat_video_retention(),
// migration 20261107220000) with x-internal-secret = the Vault
// push_internal_secret. Deploy with --no-verify-jwt (no user JWT; the
// secret is the authentication), like send-push.
// Secrets: PUSH_INTERNAL_SECRET (already set for send-push).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform;
// the service role only calls the two service-role-only SQL functions and
// removes objects in chat-video / chat-video-incoming.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleRetentionRequest, type StorageObjectRef } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const refs = (data: unknown): StorageObjectRef[] =>
  ((data ?? []) as { bucket?: unknown; name?: unknown }[])
    .filter((r) => typeof r.bucket === "string" && typeof r.name === "string")
    .map((r) => ({ bucket: r.bucket as string, name: r.name as string }));

Deno.serve((req) =>
  handleRetentionRequest(req, {
    expectedSecret: Deno.env.get("PUSH_INTERNAL_SECRET"),
    async expireDue(limit) {
      const { data, error } = await admin.rpc("chat_video_expire_due", { p_limit: limit });
      if (error) throw new Error(error.message);
      return refs(data);
    },
    async orphans(limit) {
      const { data, error } = await admin.rpc("chat_video_orphans", { p_limit: limit });
      if (error) throw new Error(error.message);
      return refs(data);
    },
    async remove(bucket, names) {
      const { error } = await admin.storage.from(bucket).remove(names);
      return error ? { error: error.message } : {};
    },
    // Counts only: never object names (they identify conversations).
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  }),
);
