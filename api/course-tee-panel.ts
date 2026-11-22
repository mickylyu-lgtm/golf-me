import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  GOLFCORE_PANEL_CSP, isGolfCoreTeeSnapshotCurrent, parseGolfCoreTeePanelRequest,
  readGolfCoreTeeSnapshot, renderGolfCoreTeePanel,
} from "../server/golfCoreTeePanel.js";

export const config = { api: { bodyParser: { sizeLimit: "1kb" } } };

const origins = new Set(["https://golfme.app", "https://www.golfme.app"]);
type Dependencies = {
  authorize: (token: string) => Promise<boolean>;
  snapshot: ReturnType<typeof readGolfCoreTeeSnapshot>;
  now: () => number;
};

export function createGolfCoreTeePanelHandler(deps: Dependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", GOLFCORE_PANEL_CSP + " frame-ancestors 'none';");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (req.method !== "POST") return res.status(405).end();
    if (req.headers.origin && !origins.has(req.headers.origin)) return res.status(403).end();
    const auth = req.headers.authorization ?? "";
    const token = /^Bearer ([a-zA-Z0-9._-]{1,4096})$/.exec(auth)?.[1];
    if (!token) return res.status(401).end();
    if (Object.keys(req.query ?? {}).length) return res.status(400).end();
    const input = parseGolfCoreTeePanelRequest(req.body);
    if (!input) return res.status(400).end();
    try {
      if (!await deps.authorize(token)) return res.status(401).end();
    } catch {
      return res.status(503).end();
    }
    if (!deps.snapshot || !isGolfCoreTeeSnapshotCurrent(deps.now())) return res.status(404).end();
    const data = deps.snapshot.get(input.courseId);
    if (!data) return res.status(404).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-GolfMe-View", "course-tee-panel-v1");
    return res.status(200).send(renderGolfCoreTeePanel(data, input.locale));
  };
}

export default createGolfCoreTeePanelHandler({
  snapshot: readGolfCoreTeeSnapshot(process.env.GOLFCORE_REVIEWED_TEE_SNAPSHOT),
  now: Date.now,
  async authorize(token) {
    // Same first-party Auth verification and publishable key as chat-video.
    // No service role, session mutation, storage/RPC use, or policy change.
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (!key) throw new Error("auth_not_configured");
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co")) throw new Error("auth_not_configured");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
    });
    const { data, error } = await client.auth.getUser(token);
    return !error && !!data.user?.id && !data.user.is_anonymous;
  },
});
