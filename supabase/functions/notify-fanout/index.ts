// Fan-out sender for "new round near you" and "new post from your Golf
// Circle" (migration 20261030120000). Never called by the app: the only
// caller is Postgres itself -- the enqueue triggers on golf_calls /
// community_posts POST {job_id} here via pg_net after the insert commits,
// authenticated with the same Vault-held shared secret send-push uses
// (PUSH_INTERNAL_SECRET), so deploy with verify_jwt disabled, like send-push.
//
// Per job:
//   1. claim_notification_fanout(job_id) (service role) picks recipients in
//      one set-based statement, records them in the idempotency ledger,
//      writes the bell rows, and returns the pushes still owed. A repeat
//      claim never creates new rows; it only re-returns unsent pushes.
//   2. One device_push_tokens query for every recipient (chunked), then
//      APNs for all tokens with bounded concurrency, dead tokens removed.
//   3. finish_notification_fanout(job_id) marks the pushes sent and closes
//      the job.
// Then it retries up to a few stale jobs (lost pg_net call, crashed run),
// so one failure heals on the next event instead of needing a cron.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getApnsJwt, mapLimit, missingApnsConfig, sendApns, tokenFingerprint, type ApnsMessage } from "../_shared/apns.ts";

const TOKEN_CHUNK = 500;
const APNS_CONCURRENCY = 50;
const STALE_SWEEP = 5;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function log(fields: Record<string, unknown>): void {
  // Ids shortened; never tokens, secrets or notification text.
  console.log(`notify-fanout ${JSON.stringify(fields)}`);
}

type OwedPush = { recipient_id: string; title: string; body: string; link_to: string };

async function processJob(admin: SupabaseClient, jobId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("claim_notification_fanout", { p_job_id: jobId });
  if (error) return { job: jobId.slice(0, 8), outcome: "claim_failed", error: error.message };
  const owed = (data ?? []) as OwedPush[];
  if (owed.length === 0) {
    // Nothing to push (skipped, already done, or bell-only recipients).
    const { error: finishError } = await admin.rpc("finish_notification_fanout", { p_job_id: jobId });
    return { job: jobId.slice(0, 8), outcome: finishError ? "finish_failed" : "no_pushes", recipients: 0 };
  }

  const byUser = new Map(owed.map((p) => [p.recipient_id, p]));
  const messages: ApnsMessage[] = [];
  const userIds = [...byUser.keys()];
  for (let i = 0; i < userIds.length; i += TOKEN_CHUNK) {
    const { data: tokens, error: tokenError } = await admin
      .from("device_push_tokens")
      .select("token, user_id")
      .in("user_id", userIds.slice(i, i + TOKEN_CHUNK));
    if (tokenError) {
      // Leave the job "processing"; the stale sweep retries it.
      return { job: jobId.slice(0, 8), outcome: "token_lookup_failed", error: tokenError.message };
    }
    for (const t of tokens ?? []) {
      const p = byUser.get(t.user_id as string);
      if (p) messages.push({ token: t.token as string, title: p.title, body: p.body, linkTo: p.link_to });
    }
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const missing = missingApnsConfig();
  if (missing.length > 0) {
    // Same best-effort posture as send-push: no retry storm over config.
    console.error(`notify-fanout: missing secrets: ${missing.join(", ")}`);
  } else if (messages.length > 0) {
    const jwt = await getApnsJwt();
    const results = await mapLimit(messages, APNS_CONCURRENCY, (m) => sendApns(jwt, m));
    const dead: string[] = [];
    for (const r of results) {
      if (r.ok) sent++;
      else {
        failed++;
        if (r.dead) dead.push(r.token);
        console.error(`notify-fanout: APNs rejected token ${await tokenFingerprint(r.token)} with ${r.status} ${r.reason}`);
      }
    }
    if (dead.length > 0) {
      const { data: gone, error: deleteError } = await admin.from("device_push_tokens").delete().in("token", dead).select("token");
      if (deleteError) console.error("notify-fanout: failed to remove dead tokens.", deleteError.message);
      removed = gone?.length ?? 0;
    }
  }

  const { error: finishError } = await admin.rpc("finish_notification_fanout", { p_job_id: jobId });
  return {
    job: jobId.slice(0, 8),
    outcome: finishError ? "finish_failed" : "done",
    recipients: owed.length,
    tokens: messages.length,
    sent,
    failed,
    removed,
    missing_config: missing,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    log({ outcome: internalSecret ? "unauthorized_secret_mismatch" : "unauthorized_secret_not_set" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let jobId: string | undefined;
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as { job_id?: unknown }).job_id;
      if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) jobId = v;
    }
  } catch {
    // fall through
  }
  if (!jobId) return jsonResponse({ error: "job_id (uuid) is required" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const outcomes = [await processJob(admin, jobId)];

  const { data: stale, error: staleError } = await admin.rpc("list_stale_notification_fanout_jobs", { p_limit: STALE_SWEEP });
  if (staleError) console.error("notify-fanout: stale sweep failed.", staleError.message);
  for (const id of (stale ?? []) as string[]) {
    if (id !== jobId) outcomes.push(await processJob(admin, id));
  }

  for (const o of outcomes) log(o);
  return jsonResponse({ outcomes });
});
