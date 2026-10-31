// Direct APNs helpers for batch senders (notify-fanout). Same provider-token
// signing, dead-token rules and token fingerprinting as send-push/index.ts,
// which is deliberately left untouched (it's live and working); folding
// send-push onto this module is a possible later cleanup, not needed now.
//
// Secrets (project-wide Edge Function secrets, already set for send-push):
// APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY, APNS_TOPIC, optional APNS_HOST.

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Apple asks callers to reuse a provider token (valid up to an hour).
let cachedToken: { jwt: string; mintedAt: number } | null = null;

export async function getApnsJwt(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.mintedAt < 45 * 60 * 1000) return cachedToken.jwt;

  const keyId = Deno.env.get("APNS_KEY_ID")!;
  const teamId = Deno.env.get("APNS_TEAM_ID")!;
  const pem = Deno.env.get("APNS_AUTH_KEY")!;
  const pkcs8 = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const derBytes = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey("pkcs8", derBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}`;
  // Web Crypto ECDSA output is already raw r||s, which ES256 expects.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;
  cachedToken = { jwt, mintedAt: Date.now() };
  return jwt;
}

// Only these mean the token itself is dead; everything else is config or
// transient and must never delete tokens.
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered"]);

export function missingApnsConfig(): string[] {
  return ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_AUTH_KEY", "APNS_TOPIC"].filter((name) => !Deno.env.get(name));
}

export function apnsHost(): string {
  return Deno.env.get("APNS_HOST") || "https://api.push.apple.com";
}

// Short SHA-256 fingerprint for logs; never any part of the token itself.
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ApnsMessage = { token: string; title: string; body: string; linkTo: string };
export type ApnsResult = { token: string; ok: boolean; status: number; reason: string; dead: boolean };

export async function sendApns(jwt: string, msg: ApnsMessage): Promise<ApnsResult> {
  const topic = Deno.env.get("APNS_TOPIC")!;
  let res: Response;
  try {
    res = await fetch(`${apnsHost()}/3/device/${msg.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default" }, link_to: msg.linkTo }),
    });
  } catch (err) {
    return { token: msg.token, ok: false, status: 0, reason: err instanceof Error ? err.message : "network error", dead: false };
  }
  if (res.ok) {
    await res.body?.cancel();
    return { token: msg.token, ok: true, status: res.status, reason: "", dead: false };
  }
  let reason = "unknown";
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed.reason === "string") reason = parsed.reason;
  } catch {
    // empty / non-JSON body
  }
  return { token: msg.token, ok: false, status: res.status, reason, dead: res.status === 410 || DEAD_TOKEN_REASONS.has(reason) };
}

// Runs fn over items with at most `limit` in flight.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
