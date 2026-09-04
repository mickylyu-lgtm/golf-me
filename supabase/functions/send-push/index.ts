// Sends a real APNs push to every device registered for a user. Never
// called directly by the app -- the only caller is the notify_new_message
// Postgres trigger (via pg_net), authenticated with a shared secret from
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
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

  const apnsHost = Deno.env.get("APNS_HOST") || "https://api.push.apple.com";
  const topic = Deno.env.get("APNS_TOPIC")!;
  const jwt = await getApnsJwt();

  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "default" },
    link_to: link_to ?? null,
  });

  let sent = 0;
  const staleTokens: string[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      const res = await fetch(`${apnsHost}/3/device/${token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        body: payload,
      });
      if (res.ok) {
        sent++;
      } else if (res.status === 400 || res.status === 410) {
        // BadDeviceToken / Unregistered -- Apple is telling us this token
        // will never work again (reinstall, app deleted, etc). Drop it so
        // future sends don't keep paying the round trip for a dead token.
        staleTokens.push(token);
      }
    }),
  );

  if (staleTokens.length > 0) {
    await adminClient.from("device_push_tokens").delete().in("token", staleTokens);
  }

  return jsonResponse({ sent, removed_stale: staleTokens.length });
});
