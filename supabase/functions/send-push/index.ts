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

// Enough of a token to tell rows apart in logs without printing the whole
// device secret.
function tokenHint(token: string): string {
  return `...${token.slice(-8)}`;
}

type SendFailure = { token: string; status: number; reason: string };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (!internalSecret) {
    // Never log either value, only which side is wrong.
    console.error("send-push: PUSH_INTERNAL_SECRET is not set on this function; every push is rejected.");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (req.headers.get("x-internal-secret") !== internalSecret) {
    console.error("send-push: x-internal-secret header does not match PUSH_INTERNAL_SECRET (check the 'push_internal_secret' Vault secret).");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { user_id, title, body, link_to } = await req.json();
  if (!user_id || !body) return jsonResponse({ error: "user_id and body are required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: tokens, error: tokensError } = await adminClient
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", user_id);

  if (tokensError) return jsonResponse({ error: tokensError.message }, 500);
  if (!tokens || tokens.length === 0) return jsonResponse({ sent: 0, reason: "no registered devices" });

  const missing = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY", "APNS_TOPIC"].filter((name) => !Deno.env.get(name));
  if (missing.length > 0) {
    console.error(`send-push: missing secrets: ${missing.join(", ")}`);
    return jsonResponse({ error: "APNs is not configured", missing }, 500);
  }

  // Production APNs is correct for TestFlight and App Store builds. A build
  // installed straight from Xcode (Debug) gets a sandbox token, which the
  // production host rejects as BadDeviceToken, so test push from TestFlight.
  const apnsHost = Deno.env.get("APNS_HOST") || "https://api.push.apple.com";
  const topic = Deno.env.get("APNS_TOPIC")!;
  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (err) {
    console.error("send-push: could not sign the APNs provider token (check APNS_AUTH_KEY is the full .p8 contents).", err);
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

  for (const f of failures) {
    const action = staleTokens.includes(f.token) ? "removing token" : "keeping token";
    console.error(`send-push: APNs rejected ${tokenHint(f.token)} with ${f.status} ${f.reason} (${action}; host ${apnsHost}, topic ${topic})`);
  }

  if (staleTokens.length > 0) {
    const { error: deleteError } = await adminClient.from("device_push_tokens").delete().in("token", staleTokens);
    if (deleteError) console.error("send-push: failed to remove dead tokens.", deleteError.message);
  }

  return jsonResponse({
    sent,
    removed_stale: staleTokens.length,
    failures: failures.map((f) => ({ token: tokenHint(f.token), status: f.status, reason: f.reason })),
  });
});
