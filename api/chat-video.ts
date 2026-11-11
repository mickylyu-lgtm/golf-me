// Chat video transcoding (DMs and round chats; migration
// 20261107220000_chat_video_albums). Runs on Vercel's Node.js runtime
// because it needs ffmpeg (same plumbing as trim-video.ts /
// extract-frames.ts, deliberately duplicated: Vercel's ESM build makes a
// shared relative import between function files fragile).
//
// Flow (the client never sends video bytes here, so Vercel's 4.5 MB request
// body limit doesn't apply):
//   1. The app uploads the ORIGINAL with a resumable (TUS) upload to the
//      private, owner-only bucket chat-video-incoming at
//      <user id>/<message id>-<item index>.orig (<= 200 MiB).
//   2. It calls POST /api/chat-video with the golfer's own access token and
//      { scope, scopeId, messageId, index, stagedPath, trim? }.
//   3. This function verifies the token (Supabase Auth), asks
//      public.chat_video_can_post (same membership rules as chat photos),
//      downloads the original through a signed URL made with THE GOLFER'S
//      token (so it can only ever read the caller's own staged file), and
//      runs ffmpeg: the trim window (<= 60 s), long edge <= 1280, H.264
//      High + AAC, ~2.5 Mb/s, +faststart, HDR -> SDR tonemap, ALL metadata
//      stripped (container, stream, chapters; location tracks dropped by
//      mapping only the first video + audio stream), and a poster JPEG.
//   4. Uploads <scope>/<scope id>/<message id>/<index>.mp4 and
//      .poster.jpg to the private chat-video bucket WITH THE GOLFER'S TOKEN,
//      so owner_id is the sender and the bucket's INSERT policy (membership,
//      unused message id) is the real gate; deletes the staged original;
//      returns the paths and the output's size + duration. The app then
//      inserts the message row (the row trigger checks the objects exist
//      and are the sender's).
// A retry after a lost answer finds the outputs already there and returns
// them again (idempotent per message id + index).
//
// Env (Vercel): SUPABASE_URL + SUPABASE_ANON_KEY, or the existing
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the publishable anon key; no
// service-role key is used or needed here).
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegPathImport from "ffmpeg-static";
import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ffmpegPath = ffmpegPathImport as unknown as string;

export const config = {
  api: { bodyParser: { sizeLimit: "16kb" } },
};

export const MAX_VIDEO_MS = 60_000;
export const MAX_STAGED_BYTES = 200 * 1024 * 1024;
/** chat-video's file_size_limit is 25 MiB; stay clear of it. */
export const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
export const LONG_EDGE = 1280;
export const MAX_ITEMS = 10;
const FFMPEG_TIMEOUT_MS = 250_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface ChatVideoRequest {
  scope: "dm" | "round";
  scopeId: string;
  messageId: string;
  index: number;
  stagedPath: string;
  trim: { startMs: number; endMs: number } | null;
}

/** Validates the body for the verified user. The staged path must be exactly this user's own staging name for this item. */
export function parseChatVideoRequest(body: unknown, userId: string): { ok: true; value: ChatVideoRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "bad_request" };
  const b = body as Record<string, unknown>;
  const scope = b.scope;
  if (scope !== "dm" && scope !== "round") return { ok: false, error: "bad_request" };
  const scopeId = typeof b.scopeId === "string" ? b.scopeId.toLowerCase() : "";
  const messageId = typeof b.messageId === "string" ? b.messageId.toLowerCase() : "";
  if (!UUID_RE.test(scopeId) || !UUID_RE.test(messageId) || !UUID_RE.test(userId)) return { ok: false, error: "bad_request" };
  const index = b.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= MAX_ITEMS) return { ok: false, error: "bad_request" };
  const stagedPath = typeof b.stagedPath === "string" ? b.stagedPath : "";
  if (stagedPath !== stagedPathFor(userId, messageId, index)) return { ok: false, error: "bad_request" };
  let trim: ChatVideoRequest["trim"] = null;
  if (b.trim !== undefined && b.trim !== null) {
    const t = b.trim as Record<string, unknown>;
    const startMs = t.startMs, endMs = t.endMs;
    if (typeof startMs !== "number" || typeof endMs !== "number" || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      return { ok: false, error: "bad_request" };
    }
    trim = { startMs, endMs };
  }
  return { ok: true, value: { scope, scopeId, messageId, index, stagedPath, trim } };
}

export function stagedPathFor(userId: string, messageId: string, index: number): string {
  return `${userId}/${messageId}-${index}.orig`;
}

export function outputPaths(req: Pick<ChatVideoRequest, "scope" | "scopeId" | "messageId" | "index">): { videoPath: string; posterPath: string } {
  const base = `${req.scope}/${req.scopeId}/${req.messageId}/${req.index}`;
  return { videoPath: `${base}.mp4`, posterPath: `${base}.poster.jpg` };
}

// ---------------------------------------------------------------------------
// Probe (ffmpeg -i stderr; ffmpeg-static ships no ffprobe). The stderr holds
// the file's metadata (GPS, device): parsed in memory, never logged/returned.
// ---------------------------------------------------------------------------

export interface ProbeInfo {
  durationMs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  transfer: string | null;
  primaries: string | null;
  matrix: string | null;
  /** "pq" (HDR10 / Dolby Vision base) or "hlg" (iPhone HDR), else null. */
  hdr: "pq" | "hlg" | null;
  tenBit: boolean;
}

export function parseProbe(stderr: string): ProbeInfo {
  const info: ProbeInfo = { durationMs: null, hasVideo: false, hasAudio: false, width: null, height: null, transfer: null, primaries: null, matrix: null, hdr: null, tenBit: false };
  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (dur) info.durationMs = Math.round(((Number(dur[1]) * 60 + Number(dur[2])) * 60 + Number(dur[3])) * 1000);
  const lines = stderr.split(/\r?\n/);
  const video = lines.find((l) => /Stream #\d+:\d+.*: Video: /.test(l) && !/attached pic/.test(l));
  info.hasAudio = lines.some((l) => /Stream #\d+:\d+.*: Audio: /.test(l));
  if (video) {
    info.hasVideo = true;
    const size = /,\s*(\d{2,5})x(\d{2,5})[\s,]/.exec(video);
    if (size) {
      info.width = Number(size[1]);
      info.height = Number(size[2]);
    }
    info.tenBit = /p1[02](le|be)/.test(video);
    // e.g. "yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive)" or "yuv420p(tv, bt709)"
    const colour = /\b(?:yuv|yuvj|nv|p0|gbr)[a-z0-9]*\(([^)]*)\)/.exec(video);
    if (colour) {
      const parts = colour[1].split(",").map((s) => s.trim());
      const triple = parts.find((p) => p.includes("/"));
      if (triple) {
        const [m, p, t] = triple.split("/");
        info.matrix = m ?? null;
        info.primaries = p ?? null;
        info.transfer = t ?? null;
      } else {
        const single = parts.find((p) => /^(bt|smpte|arib)/.test(p));
        if (single) info.matrix = info.primaries = info.transfer = single;
      }
    }
    if (info.transfer === "smpte2084") info.hdr = "pq";
    else if (info.transfer === "arib-std-b67") info.hdr = "hlg";
  }
  return info;
}

// ---------------------------------------------------------------------------
// Window, ffmpeg arguments
// ---------------------------------------------------------------------------

/** The part of the original to keep: the golfer's trim, clamped to the clip and to 60 s; no trim = the first 60 s. */
export function chooseWindow(durationMs: number | null, trim: ChatVideoRequest["trim"]): { startS: number; lengthS: number } {
  const total = durationMs && durationMs > 0 ? durationMs : null;
  let start = trim ? Math.max(0, trim.startMs) : 0;
  let end = trim ? trim.endMs : (total ?? MAX_VIDEO_MS);
  if (total !== null) {
    start = Math.min(start, Math.max(0, total - 100));
    end = Math.min(end, total);
  }
  end = Math.min(end, start + MAX_VIDEO_MS);
  const length = Math.max(100, end - start);
  return { startS: Math.round(start) / 1000, lengthS: Math.round(length) / 1000 };
}

export interface FilterSupport {
  zscale: boolean;
  tonemap: boolean;
  colorspace: boolean;
}

/** Long edge <= 1280, even sizes, never upscaled. Runs after ffmpeg's autorotate, so a portrait phone clip stays portrait. */
export const SCALE_FILTER =
  `scale=w='if(gte(iw,ih),trunc(min(${LONG_EDGE},iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(${LONG_EDGE},ih)/2)*2)':flags=bicubic`;

export function videoFilter(probe: Pick<ProbeInfo, "hdr" | "primaries" | "matrix">, filters: FilterSupport): string {
  const steps = [SCALE_FILTER];
  if (probe.hdr && filters.zscale && filters.tonemap) {
    const tin = probe.hdr === "pq" ? "smpte2084" : "arib-std-b67";
    steps.push(
      `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
    );
  } else if (probe.hdr && filters.colorspace) {
    // No zimg in this build: a plain BT.2020 -> BT.709 conversion (no real
    // tonemap: highlights clip, but colours are right and it plays everywhere).
    steps.push("colorspace=all=bt709:iall=bt2020:fast=1");
  }
  steps.push("setsar=1", "format=yuv420p");
  return steps.join(",");
}

/** Every flag that keeps identifying data out of the output. */
export const STRIP_METADATA_ARGS = [
  "-map_metadata", "-1",
  "-map_metadata:s", "-1",
  "-map_chapters", "-1",
  "-fflags", "+bitexact",
  "-flags:v", "+bitexact",
  "-flags:a", "+bitexact",
  "-sn", "-dn",
] as const;

export function buildTranscodeArgs(opts: {
  input: string;
  output: string;
  window: { startS: number; lengthS: number };
  probe: Pick<ProbeInfo, "hdr" | "primaries" | "matrix" | "hasAudio">;
  filters: FilterSupport;
  /** kb/s cap; the second pass for an oversized result asks for less. */
  maxrateK?: number;
}): string[] {
  const maxrate = opts.maxrateK ?? 2500;
  const args = [
    "-hide_banner", "-nostdin", "-y",
    "-ss", opts.window.startS.toFixed(3),
    "-i", opts.input,
    "-t", opts.window.lengthS.toFixed(3),
    // Only the first video and audio stream: iPhone's location / motion
    // "mebx" tracks and any subtitle / data stream never reach the output.
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", videoFilter(opts.probe, opts.filters),
    "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast",
    "-crf", maxrate >= 2500 ? "23" : "26",
    "-maxrate", `${maxrate}k`, "-bufsize", `${maxrate * 2}k`,
    "-pix_fmt", "yuv420p",
    "-fpsmax", "30",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
    ...STRIP_METADATA_ARGS,
    "-movflags", "+faststart",
    "-f", "mp4",
    opts.output,
  ];
  return args;
}

export function buildPosterArgs(opts: { input: string; output: string; atS: number }): string[] {
  return [
    "-hide_banner", "-nostdin", "-y",
    "-ss", Math.max(0, opts.atS).toFixed(3),
    "-i", opts.input,
    "-frames:v", "1",
    "-vf", "format=yuvj420p",
    "-q:v", "4",
    ...STRIP_METADATA_ARGS,
    "-f", "image2", "-c:v", "mjpeg",
    opts.output,
  ];
}

/** Where the poster frame comes from: half a second in (past a fade-in), never past a third of the clip. */
export function posterTime(lengthS: number): number {
  return Math.max(0, Math.min(0.5, lengthS / 3));
}

// ---------------------------------------------------------------------------
// MP4 inspection: the output's size / duration, and a metadata scan
// ---------------------------------------------------------------------------

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "edts", "dinf", "mvex", "moof", "traf"]);

export interface Mp4Box {
  type: string;
  path: string;
  start: number;
  size: number;
  headerSize: number;
}

/** Every box (atom) in the file, depth-first, with its path (e.g. "moov/udta/©xyz"). Malformed sizes stop the walk. */
export function mp4Boxes(bytes: Uint8Array): Mp4Box[] {
  const out: Mp4Box[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const walk = (from: number, to: number, prefix: string, depth: number) => {
    let i = from;
    while (i + 8 <= to) {
      let size = view.getUint32(i);
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      let header = 8;
      if (size === 1) {
        if (i + 16 > to) return;
        size = Number(view.getBigUint64(i + 8));
        header = 16;
      } else if (size === 0) {
        size = to - i;
      }
      if (size < header || i + size > to) return;
      const p = prefix ? `${prefix}/${type}` : type;
      out.push({ type, path: p, start: i, size, headerSize: header });
      if (depth < 8) {
        if (CONTAINERS.has(type)) walk(i + header, i + size, p, depth + 1);
        else if (type === "meta") walk(i + header + 4, i + size, p, depth + 1); // full box: 4 bytes version/flags
        else if (type === "ilst") walk(i + header, i + size, p, depth + 1);
      }
      i += size;
    }
  };
  walk(0, bytes.length, "", 0);
  return out;
}

const COPYRIGHT_SIGN = String.fromCharCode(0xa9);

/** Boxes that carry user / device / location metadata. An output must have none. */
export function metadataBoxes(bytes: Uint8Array): string[] {
  return mp4Boxes(bytes)
    .filter((b) => b.type === "udta" || b.type === "meta" || b.type === "ilst" || b.type === "keys" || b.type === "loci" || b.type === "XMP_" || b.type === "uuid" || b.type.startsWith(COPYRIGHT_SIGN))
    .map((b) => b.path);
}

/**
 * Belt and braces after ffmpeg's own stripping (its mp4 muxer still writes
 * an empty moov/udta/meta/ilst shell): every top-most metadata box is
 * turned into a "free" box of the same size with its payload zeroed. Same
 * size = no offset changes (chunk offsets stay valid); players skip "free".
 * Returns how many boxes were neutralized. Mutates `bytes`.
 */
export function neutralizeMetadataBoxes(bytes: Uint8Array): number {
  const found = mp4Boxes(bytes).filter(
    (b) => b.type === "udta" || b.type === "meta" || b.type === "XMP_" || b.type === "uuid" || b.type === "loci" || b.type.startsWith(COPYRIGHT_SIGN),
  );
  // Only the outermost ones (a nested one is wiped with its parent).
  const outer = found.filter((b) => !found.some((o) => o !== b && b.start > o.start && b.start < o.start + o.size));
  for (const b of outer) {
    if (b.headerSize !== 8) continue;
    bytes[b.start + 4] = 0x66; // f
    bytes[b.start + 5] = 0x72; // r
    bytes[b.start + 6] = 0x65; // e
    bytes[b.start + 7] = 0x65; // e
    bytes.fill(0, b.start + 8, b.start + b.size);
  }
  return outer.length;
}

/** Duration (from mvhd) and the video track's display size (from its tkhd). */
export function mp4Info(bytes: Uint8Array): { durationMs: number; width: number; height: number } | null {
  const boxes = mp4Boxes(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mvhd = boxes.find((b) => b.path === "moov/mvhd");
  if (!mvhd) return null;
  const v = bytes[mvhd.start + mvhd.headerSize];
  const base = mvhd.start + mvhd.headerSize + 4;
  const timescale = v === 1 ? view.getUint32(base + 16) : view.getUint32(base + 8);
  const duration = v === 1 ? Number(view.getBigUint64(base + 20)) : view.getUint32(base + 12);
  let width = 0, height = 0;
  for (const trak of boxes.filter((b) => b.path === "moov/trak")) {
    const inside = boxes.filter((b) => b.start > trak.start && b.start < trak.start + trak.size);
    const hdlr = inside.find((b) => b.type === "hdlr");
    if (!hdlr) continue;
    const handler = String.fromCharCode(...bytes.subarray(hdlr.start + hdlr.headerSize + 8, hdlr.start + hdlr.headerSize + 12));
    if (handler !== "vide") continue;
    const tkhd = inside.find((b) => b.type === "tkhd");
    if (!tkhd) continue;
    // tkhd ends with width, height as 16.16 fixed point.
    const end = tkhd.start + tkhd.size;
    width = Math.round(view.getUint32(end - 8) / 65536);
    height = Math.round(view.getUint32(end - 4) / 65536);
    break;
  }
  if (!timescale || !width || !height) return null;
  return { durationMs: Math.max(1, Math.round((duration / timescale) * 1000)), width, height };
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

export class FfmpegError extends Error {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderrTail: string;
  constructor(exitCode: number | null, signal: string | null, stderrTail: string) {
    super("ffmpeg failed");
    this.name = "FfmpegError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
  }
}

export function runFfmpeg(args: string[], { allowFailure = false, timeoutMs = FFMPEG_TIMEOUT_MS } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 || allowFailure) resolve(stderr);
      else reject(new FfmpegError(code, signal, stderr.slice(-4000)));
    });
  });
}

let filterSupport: Promise<FilterSupport> | null = null;
export function detectFilters(): Promise<FilterSupport> {
  if (!filterSupport) {
    filterSupport = new Promise<string>((resolve) => {
      if (!ffmpegPath) return resolve("");
      const proc = spawn(ffmpegPath, ["-hide_banner", "-filters"]);
      let out = "";
      proc.stdout?.on("data", (c) => (out += c.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", () => resolve(out));
    }).then((list) => ({
      zscale: /\szscale\s/.test(list),
      tonemap: /\stonemap\s/.test(list),
      colorspace: /\scolorspace\s/.test(list),
    }));
  }
  return filterSupport;
}

export function classifyFfmpegFailure(err: unknown): { status: number; token: string } {
  if (!(err instanceof FfmpegError)) return { status: 500, token: "internal" };
  const tail = err.stderrTail;
  if (err.signal === "SIGKILL") return { status: 500, token: "timeout" };
  if (/Cannot allocate memory|ENOMEM|ENOSPC|No space left on device/i.test(tail)) return { status: 500, token: "resources_exhausted" };
  if (/matches no streams|does not contain any stream/i.test(tail)) return { status: 422, token: "no_video_stream" };
  if (/Invalid data found|moov atom not found|could not find codec parameters|Error while decoding|Decoder .* not found|Unsupported codec|Error opening input/i.test(tail)) {
    return { status: 422, token: "decode_failed" };
  }
  return { status: 500, token: "internal" };
}

/** Full pipeline on local files (exported for tests): probe, transcode (+ a smaller second pass if needed), poster, checks. */
export async function transcodeLocal(opts: { input: string; workDir: string; trim: ChatVideoRequest["trim"] }): Promise<
  | { ok: true; video: string; poster: string; info: { durationMs: number; width: number; height: number } }
  | { ok: false; status: number; error: string }
> {
  const probe = parseProbe(await runFfmpeg(["-hide_banner", "-nostdin", "-i", opts.input], { allowFailure: true }));
  if (!probe.hasVideo) return { ok: false, status: 422, error: "no_video_stream" };
  const window = chooseWindow(probe.durationMs, opts.trim);
  const filters = await detectFilters();
  const video = path.join(opts.workDir, "out.mp4");
  const poster = path.join(opts.workDir, "poster.jpg");
  await runFfmpeg(buildTranscodeArgs({ input: opts.input, output: video, window, probe, filters }));
  if ((await stat(video)).size > MAX_OUTPUT_BYTES) {
    await runFfmpeg(buildTranscodeArgs({ input: opts.input, output: video, window, probe, filters, maxrateK: 1500 }));
    if ((await stat(video)).size > MAX_OUTPUT_BYTES) return { ok: false, status: 422, error: "too_large" };
  }
  const bytes = new Uint8Array(await readFile(video));
  if (neutralizeMetadataBoxes(bytes) > 0) await writeFile(video, bytes);
  // Fail closed: never store an output that still carries metadata boxes.
  if (metadataBoxes(bytes).length > 0) return { ok: false, status: 500, error: "metadata_not_stripped" };
  const info = mp4Info(bytes);
  if (!info) return { ok: false, status: 500, error: "internal" };
  await runFfmpeg(buildPosterArgs({ input: video, output: poster, atS: posterTime(info.durationMs / 1000) }));
  return { ok: true, video, poster, info };
}

// Database-backed, cross-replica budgets. Never substitute an in-memory Map:
// replicas, cold starts, refreshed JWTs and changed IPs would reset it.
type BudgetAction = "chat-video";
export interface BudgetClient {
  rpc(name: string, args: Record<string, unknown>): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; code: "rate_limited" | "rate_limit_unavailable"; retryAfter: number };

export async function consumeRequestBudget(client: BudgetClient, action: BudgetAction): Promise<BudgetDecision> {
  // Fail closed on missing migration, timeouts and malformed answers. No
  // provider/ffmpeg work is allowed when the central counter is unavailable.
  const unavailable: BudgetDecision = { allowed: false, status: 503, code: "rate_limit_unavailable", retryAfter: 30 };
  try {
    const { data, error } = await client.rpc("consume_request_budget", { p_action: action })
      .abortSignal(AbortSignal.timeout(5000));
    if (error || !data || typeof data !== "object") return unavailable;
    const d = data as Record<string, unknown>;
    if (d.allowed === true && d.retry_after_seconds === 0) return { allowed: true };
    if (d.allowed === false && typeof d.retry_after_seconds === "number" &&
        Number.isInteger(d.retry_after_seconds) && d.retry_after_seconds >= 1 && d.retry_after_seconds <= 86400) {
      return { allowed: false, status: 429, code: "rate_limited", retryAfter: d.retry_after_seconds };
    }
    return unavailable;
  } catch {
    return unavailable;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co")) return null;
  } catch {
    return null;
  }
  return { url, anonKey };
}

function isAlreadyThere(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const env = supabaseEnv();
  if (!env) return res.status(500).json({ error: "not_configured" });
  const auth = req.headers.authorization ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return res.status(401).json({ error: "unauthorized" });

  // Every Storage / RPC call below runs as the golfer (their token), never
  // as a service role: RLS and the storage policies decide.
  const client = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (userError || !userId || userData.user?.is_anonymous) return res.status(401).json({ error: "unauthorized" });

  const parsed = parseChatVideoRequest(req.body, userId);
  if (parsed.ok === false) return res.status(400).json({ error: parsed.error });
  const request = parsed.value;
  const { videoPath, posterPath } = outputPaths(request);

  // Before Storage download or any ffmpeg work. Counts attempts (including
  // retries) so parallel duplicate requests cannot multiply expensive work.
  const budget = await consumeRequestBudget(client, "chat-video");
  if (budget.allowed === false) {
    res.setHeader("Retry-After", String(budget.retryAfter));
    res.setHeader("Cache-Control", "no-store");
    return res.status(budget.status).json({ error: budget.code, retryAfterSeconds: budget.retryAfter });
  }

  const { data: allowed, error: allowedError } = await client.rpc("chat_video_can_post", {
    p_scope: request.scope,
    p_scope_id: request.scopeId,
    p_message_id: request.messageId,
  });
  if (allowedError) return res.status(502).json({ error: "check_failed" });

  const videoBucket = client.storage.from("chat-video");
  const staging = client.storage.from("chat-video-incoming");

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), "chat-video-"));

    // Idempotent retry: this item was already produced (the answer was lost).
    const existing = await videoBucket.download(videoPath);
    if (!existing.error && existing.data) {
      const info = mp4Info(new Uint8Array(await existing.data.arrayBuffer()));
      const poster = await videoBucket.download(posterPath);
      if (info && !poster.error) {
        await staging.remove([request.stagedPath]).catch(() => undefined);
        return res.status(200).json({ videoPath, posterPath, ...info });
      }
    }
    if (allowed !== true) return res.status(403).json({ error: "not_allowed" });

    const signed = await staging.createSignedUrl(request.stagedPath, 600);
    if (signed.error || !signed.data?.signedUrl) return res.status(404).json({ error: "staged_missing" });
    let source: Response;
    try {
      source = await fetch(signed.data.signedUrl);
    } catch {
      return res.status(502).json({ error: "source_fetch_failed" });
    }
    if (!source.ok || !source.body) return res.status(502).json({ error: "source_fetch_failed" });
    const declared = Number(source.headers.get("content-length") ?? "0");
    if (declared > MAX_STAGED_BYTES) return res.status(413).json({ error: "too_large" });
    const input = path.join(workDir, "input.orig");
    let seen = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        seen += chunk.length;
        if (seen > MAX_STAGED_BYTES) return done(new Error("too_large"));
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(source.body as Parameters<typeof Readable.fromWeb>[0]), cap, createWriteStream(input));
    } catch {
      return res.status(seen > MAX_STAGED_BYTES ? 413 : 502).json({ error: seen > MAX_STAGED_BYTES ? "too_large" : "source_fetch_failed" });
    }

    const result = await transcodeLocal({ input, workDir, trim: request.trim });
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    const posterUp = await videoBucket.upload(posterPath, await readFile(result.poster), { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
    if (posterUp.error && !isAlreadyThere(posterUp.error as { message?: string; statusCode?: string })) return res.status(403).json({ error: "upload_refused" });
    const videoUp = await videoBucket.upload(videoPath, await readFile(result.video), { contentType: "video/mp4", upsert: false, cacheControl: "3600" });
    if (videoUp.error && !isAlreadyThere(videoUp.error as { message?: string; statusCode?: string })) return res.status(403).json({ error: "upload_refused" });

    await staging.remove([request.stagedPath]).catch(() => undefined);
    return res.status(200).json({ videoPath, posterPath, ...result.info });
  } catch (err) {
    // A classified token only: never ffmpeg's stderr (it echoes GPS/device
    // metadata), never a thrown message (it can embed the signed URL).
    const { status, token } = classifyFfmpegFailure(err);
    console.error("[chat-video] failed", { error: token, errorName: err instanceof Error ? err.name : typeof err });
    return res.status(status).json({ error: token });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
