// Sends a real APNs push to every device registered for a user. Never
// called directly by the app -- the only callers are the notify_new_message,
// notify_round_joined and notify_caddie_analysis_complete Postgres triggers
// (via pg_net), authenticated with a shared secret from
// Vault rather than a normal user JWT, so this function is deployed with
// verify_jwt disabled and does its own check instead (see PUSH_INTERNAL_SECRET
// below). That's a deliberate exception to "always verify_jwt": there is no
// end-user session at all in this call path, only Postgres talking to itself.
//
// APNs requires an ES256-signed JWT (the "provider authentication token")
// and an HTTP/2 connection -- Postgres/pg_net can do neither, which is the
// entire reason this is a separate Edge Function rather than a direct
// pg_net call straight to Apple (contrast the waitlist-signup email trigger,
// which calls Resend directly from pg_net since Resend needs neither).
//
// Required secrets (Supabase Dashboard -> Edge Functions -> send-push ->
// Secrets -- none of these can be set by an AI session, dashboard-only,
// same limitation already documented for GEOAPIFY_API_KEY):
//   PUSH_INTERNAL_SECRET  -- must exactly match the 'push_internal_secret'
//                            Vault secret the trigger reads
//   APNS_KEY_ID           -- from the .p8 Auth Key created in Apple Developer
//   APNS_TEAM_ID          -- Apple Developer Team ID
//   APNS_AUTH_KEY         -- the .p8 file's full contents, including the
//                            BEGIN/END PRIVATE KEY lines
//   APNS_TOPIC            -- the app bundle id, "com.golfme.ios"
// Until all five are set, this function 401s or 500s and every push is a
// silent no-op from the trigger's side (see notify_new_message's own
// "no secret configured -> skip" branch) -- it never blocks a DM from
// sending, only the push notification about it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// APNs provider tokens are valid up to an hour; Apple explicitly asks
// callers not to mint a fresh one per request. Cached at module scope so a
// warm Edge Function isolate (handling several messages in a row) reuses it.
let cachedToken: { jwt: string; mintedAt: number } | null = null;

async function getApnsJwt(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.mintedAt < 45 * 60 * 1000) {
    return cachedToken.jwt;
  }

  const keyId = Deno.env.get("APNS_KEY_ID")!;
  const teamId = Deno.env.get("APNS_TEAM_ID")!;
  const pem = Deno.env.get("APNS_AUTH_KEY")!;

  const pkcs8 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const derBytes = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    derBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}`;

  // Web Crypto's ECDSA signatures are already in the raw (r || s) IEEE
  // P1363 format JWS/ES256 expects -- no DER-to-raw conversion needed,
  // unlike most non-browser JWT libraries which sign ASN.1 DER by default.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(unsigned));

  const jwt = `${unsigned}.${base64url(signature)}`;
  cachedToken = { jwt, mintedAt: Date.now() };
  return jwt;
}

// APNs failure reasons that mean this token itself is dead, so deleting the
// row is correct. Everything else (DeviceTokenNotForTopic, TopicDisallowed,
// InvalidProviderToken, ExpiredProviderToken, MissingTopic, BadTopic, 403s,
// 429s, 5xx) is a server-side config or transient problem: deleting on those
// would wipe every user's token over one bad secret. Those are logged and
// the tokens are kept.
// https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered"]);

// Logs and responses identify tokens only by a short SHA-256 fingerprint —
// never by any part of the token itself. The same fingerprint can be
// computed from device_push_tokens in SQL (left(encode(digest(token,
// 'sha256'),'hex'), 10)) to match a log line to a row.
async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
}

// One structured line per push call, safe to read in the dashboard logs:
// shortened user id, counts, and per-failure fingerprint + APNs status/reason.
// Never raw tokens, keys, secrets, emails or the message text.
function logOutcome(fields: Record<string, unknown>): void {
  console.log(`send-push outcome ${JSON.stringify(fields)}`);
}

// Same field shape for paths that end before the recipient is known.
const EMPTY_OUTCOME = {
  user: null,
  tokens_found: null,
  sent: 0,
  failed: 0,
  removal_attempted: 0,
  removed: 0,
  apns_env: null,
  topic: null,
  missing_config: [],
  failures: [],
};

type SendFailure = { token: string; status: number; reason: string };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    logOutcome({ ...EMPTY_OUTCOME, outcome: "method_not_allowed" });
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (!internalSecret) {
    // Never log either value, only which side is wrong.
    console.error("send-push: PUSH_INTERNAL_SECRET is not set on this function; every push is rejected.");
    logOutcome({ ...EMPTY_OUTCOME, outcome: "unauthorized_secret_not_set" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("send-push: x-internal-secret header does not match PUSH_INTERNAL_SECRET (check the 'push_internal_secret' Vault secret).");
    logOutcome({ ...EMPTY_OUTCOME, outcome: "unauthorized_secret_mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payloadIn: { user_id?: string; title?: string; body?: string; link_to?: string };
  try {
    const parsed: unknown = await req.json();
    // JSON can legally be null, an array or a scalar; only a plain object is a valid request.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payloadIn = parsed as typeof payloadIn;
  } catch {
    logOutcome({ ...EMPTY_OUTCOME, outcome: "bad_request" });
    return jsonResponse({ error: "request body must be a JSON object" }, 400);
  }
  const { user_id, title, body, link_to } = payloadIn;
  if (!user_id || !body) {
    logOutcome({ ...EMPTY_OUTCOME, outcome: "bad_request" });
    return jsonResponse({ error: "user_id and body are required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: tokens, error: tokensError } = await adminClient
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", user_id);

  // Production APNs is correct for TestFlight and App Store builds. A build
  // installed straight from Xcode (Debug) gets a sandbox token, which the
  // production host rejects as BadDeviceToken, so test push from TestFlight.
  const apnsHost = Deno.env.get("APNS_HOST") || "https://api.push.apple.com";
  // Every return path logs this same shape; fields that don't apply on a
  // path are explicit nulls/zeros rather than missing.
  const base = {
    user: String(user_id).slice(0, 8),
    tokens_found: null as number | null,
    sent: 0,
    failed: 0,
    removal_attempted: 0,
    removed: 0,
    apns_env: apnsHost.includes("sandbox") ? "sandbox" : "production",
    topic: Deno.env.get("APNS_TOPIC") ?? null,
    missing_config: [] as string[],
    failures: [] as unknown[],
  };

  if (tokensError) {
    logOutcome({ ...base, outcome: "token_lookup_failed" });
    return jsonResponse({ error: tokensError.message }, 500);
  }
  if (!tokens || tokens.length === 0) {
    logOutcome({ ...base, outcome: "no_registered_devices", tokens_found: 0 });
    return jsonResponse({ sent: 0, reason: "no registered devices" });
  }
  base.tokens_found = tokens.length;

  const missing = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY", "APNS_TOPIC"].filter((name) => !Deno.env.get(name));
  if (missing.length > 0) {
    console.error(`send-push: missing secrets: ${missing.join(", ")}`);
    logOutcome({ ...base, outcome: "apns_not_configured", missing_config: missing });
    return jsonResponse({ error: "APNs is not configured", missing }, 500);
  }

  const topic = Deno.env.get("APNS_TOPIC")!;
  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (err) {
    console.error("send-push: could not sign the APNs provider token (check APNS_AUTH_KEY is the full .p8 contents).", err);
    logOutcome({ ...base, outcome: "apns_auth_failed" });
    return jsonResponse({ error: "APNs provider token signing failed" }, 500);
  }

  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "default" },
    link_to: link_to ?? null,
  });

  let sent = 0;
  const staleTokens: string[] = [];
  const failures: SendFailure[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      let res: Response;
      try {
        res = await fetch(`${apnsHost}/3/device/${token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": topic,
            "apns-push-type": "alert",
            "apns-priority": "10",
          },
          body: payload,
        });
      } catch (err) {
        failures.push({ token, status: 0, reason: err instanceof Error ? err.message : "network error" });
        return;
      }
      if (res.ok) {
        sent++;
        return;
      }
      // APNs error bodies look like {"reason":"BadDeviceToken"}.
      let reason = "unknown";
      try {
        const parsed = await res.json();
        if (parsed && typeof parsed.reason === "string") reason = parsed.reason;
      } catch {
        // Empty or non-JSON body, keep "unknown".
      }
      failures.push({ token, status: res.status, reason });
      // A 410 always means the token is no longer active for this topic.
      if (res.status === 410 || DEAD_TOKEN_REASONS.has(reason)) staleTokens.push(token);
    }),
  );

  // Removal is reported from the rows the delete actually returned, not from
  // intent or the mere absence of an error (a concurrent delete can leave
  // nothing to remove).
  const deletedTokens = new Set<string>();
  let deleteFailed = false;
  if (staleTokens.length > 0) {
    const { data: deletedRows, error: deleteError } = await adminClient
      .from("device_push_tokens")
      .delete()
      .in("token", staleTokens)
      .select("token");
    if (deleteError) {
      deleteFailed = true;
      console.error("send-push: failed to remove dead tokens.", deleteError.message);
    }
    for (const row of deletedRows ?? []) deletedTokens.add((row as { token: string }).token);
  }

  const failureInfo = await Promise.all(
    failures.map(async (f) => ({
      token_fp: await tokenFingerprint(f.token),
      status: f.status,
      reason: f.reason,
      removal: !staleTokens.includes(f.token)
        ? "not_needed"
        : deletedTokens.has(f.token)
          ? "removed"
          : deleteFailed
            ? "removal_failed"
            : "already_gone",
    })),
  );
  for (const f of failureInfo) {
    console.error(`send-push: APNs rejected token ${f.token_fp} with ${f.status} ${f.reason} (${f.removal}; topic ${topic})`);
  }

  const removed = deletedTokens.size;
  logOutcome({
    ...base,
    outcome: failures.length === 0 ? "delivered_to_apns" : sent > 0 ? "partial" : "all_failed",
    sent,
    failed: failures.length,
    removal_attempted: staleTokens.length,
    removed,
    failures: failureInfo,
  });

  return jsonResponse({
    sent,
    removed_stale: removed,
    failures: failureInfo.map(({ token_fp, status, reason, removal }) => ({ token_fp, status, reason, removal })),
  });
});
