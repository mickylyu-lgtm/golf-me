import type { VercelRequest, VercelResponse } from "@vercel/node";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const TOKEN = /^[0-9a-f]{64}$/;
const ORIGIN = "https://golfme.app";
export type Preview = { kind: "post" | "round"; id: string; image_url?: string | null; course?: string; place?: string; date_iso?: string; time?: string };
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function safeImageUrl(value: string | null | undefined, supabaseUrl: string): string | null {
  try {
    const u = new URL(value ?? ""), base = new URL(supabaseUrl);
    if (u.origin !== base.origin || u.protocol !== "https:" || !u.pathname.startsWith("/storage/v1/object/public/community-media/") || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
export function previewHtml(data: Preview | null, token: string): string {
  const title = data?.kind === "round" ? (data.course || "Golf round on GolfMe") : "GolfMe community";
  const description = data?.kind === "round" ? [data.place, data.time].filter(Boolean).join(" · ") : "View this post on GolfMe.";
  const target = data ? (data.kind === "post" ? "/community/" : "/golf-calls/") + data.id : "/";
  const image = data ? ORIGIN + "/api/share-preview?image=1&token=" + token : ORIGIN + "/og.png";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + escapeHtml(title) + '</title><meta property="og:type" content="website"><meta property="og:site_name" content="GolfMe"><meta property="og:title" content="' + escapeHtml(title) + '"><meta property="og:description" content="' + escapeHtml(description) + '"><meta property="og:url" content="' + ORIGIN + '/s/' + token + '"><meta property="og:image" content="' + escapeHtml(image) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + escapeHtml(image) + '"></head><body style="font:20px system-ui;padding:40px;background:#f8f7f2;color:#173c27"><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(description) + '</p><a href="' + target + '">Open in GolfMe</a><script>location.replace(' + JSON.stringify(target) + ')</script></body></html>';
}
function lines(value: string, width: number, max: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const result: string[] = [""];
  for (const word of words) {
    const i = result.length - 1;
    if ((result[i] + " " + word).trim().length > width && result[i]) {
      if (result.length === max) { result[i] = result[i].slice(0, width - 1) + "…"; break; }
      result.push(word.slice(0, width));
    } else result[i] = (result[i] + " " + word).trim();
  }
  return result;
}
export function roundSvg(data: Preview): string {
  const course = lines(data.course || "Golf round", 34, 2);
  // date_iso is the host's calendar date; do not shift it through server timezone.
  const datePart = data.date_iso?.slice(0, 10);
  const date = datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)
    ? new Date(datePart + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g"><stop stop-color="#173e28"/><stop offset="1" stop-color="#0b2418"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><g font-family="sans-serif"><text x="60" y="90" font-size="26" fill="#f2c65b">JOIN A ROUND</text>' + course.map((s, i) => '<text x="60" y="' + (195 + i * 67) + '" font-size="54" font-weight="700" fill="white">' + escapeHtml(s) + '</text>').join("") + lines(data.place || "Course location", 65, 2).map((s, i) => '<text x="60" y="' + (355 + i * 42) + '" font-size="30" fill="#d0e0d5">' + escapeHtml(s) + '</text>').join("") + '<text x="60" y="515" font-size="38" font-weight="600" fill="#f2c65b">' + escapeHtml([date, data.time].filter(Boolean).join(" · ").slice(0, 65)) + '</text><text x="60" y="582" font-size="24" fill="#d0e0d5">GolfMe · Find your foursome</text></g></svg>';
}
export async function renderImage(data: Preview, supabaseUrl: string): Promise<Buffer> {
  let canvas: Buffer;
  const media = data.kind === "post" ? safeImageUrl(data.image_url, supabaseUrl) : null;
  if (media) {
    const response = await fetch(media, { redirect: "error", signal: AbortSignal.timeout(7000) });
    if (!response.ok || !/^image\/(jpeg|png|webp|avif)/i.test(response.headers.get("content-type") || "")) throw new Error("Unavailable image");
    const reader = response.body?.getReader(); if (!reader) throw new Error("Missing image");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12 * 1024 * 1024) throw new Error("Oversized image"); chunks.push(value); } } finally { await reader.cancel(); }
    canvas = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate().resize(1200, 630, { fit: "contain", background: "#102d1d" }).png().toBuffer();
  } else {
    const card = data.kind === "round" ? roundSvg(data) : roundSvg({ kind: "round", id: data.id, course: "GolfMe community", place: "View this post on GolfMe." }).replace("JOIN A ROUND", "COMMUNITY POST").replace("GolfMe · Find your foursome", "GolfMe");
    canvas = await sharp(Buffer.from(card)).png().toBuffer();
  }
  const logo = await sharp(await readFile(path.join(process.cwd(), "public/icon-source.svg"))).resize(88, 88).png().toBuffer();
  return sharp(canvas).composite([{ input: logo, top: 24, left: 1088 }]).jpeg({ quality: 88 }).toBuffer();
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!TOKEN.test(token)) return res.status(404).end();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  try {
    const response = await fetch(url + "/rest/v1/rpc/resolve_share_preview", { method: "POST", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ p_token: token }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Preview lookup failed");
    const data = await response.json() as Preview | null;
    if (req.query.image === "1") {
      if (!data) return res.status(404).end();
      res.setHeader("Content-Type", "image/jpeg");
      return res.status(200).send(await renderImage(data, url));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(previewHtml(data, token));
  } catch {
    // No stale or unrestricted media fallback when authorization/lookup fails.
    return res.status(503).end();
  }
}
