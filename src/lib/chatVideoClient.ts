// Browser side of chat videos and albums (rules in lib/chatMedia.ts):
// reading a picked video on the device (size, length, a poster frame),
// the resumable upload of the original to chat-video-incoming (TUS, so a
// dropped connection resumes instead of starting over), the call to our
// transcoder (api/chat-video.ts), album photo uploads, removal after
// unsend / discard, and the signed-URL cache for the private chat-video
// bucket.
import { supabase } from "./supabase";
import { uploadChatImage } from "./chatImageClient";
import { createChatImageUrlCache, type ChatImageUrlCache } from "./chatImageUrlCache";
import {
  CHAT_VIDEO_BUCKET,
  CHAT_VIDEO_STAGING_BUCKET,
  CHAT_VIDEO_URL_TTL_S,
  VIDEO_STAGED_MAX_BYTES,
  classifyVideoProcess,
  isDemoMediaPath,
  mediaItemPath,
  mediaPosterPath,
  mediaPrefix,
  stagedVideoPath,
  type ChatScope,
  type MediaSendItem,
  type PreparedChatVideo,
} from "./chatMedia";
import { progressStep, type ImageSendFailure } from "./chatImages";

// ---------------------------------------------------------------------------
// Reading a picked video
// ---------------------------------------------------------------------------

export class ChatVideoError extends Error {
  readonly reason: "tooLarge" | "unreadable";
  constructor(reason: "tooLarge" | "unreadable") {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Size, length and a poster frame of a picked video, read by the browser
 * (nothing is re-encoded here). A file this browser can't decode (an
 * iPhone HEVC clip on a desktop) is still sendable: size / length come
 * back 0 and the server works it out. Only a file over the staging limit,
 * or one that isn't a video at all, is refused.
 */
export async function readChatVideo(file: File, timeoutMs = 8000): Promise<PreparedChatVideo> {
  if (file.type && !file.type.startsWith("video/")) throw new ChatVideoError("unreadable");
  if (file.size === 0) throw new ChatVideoError("unreadable");
  if (file.size > VIDEO_STAGED_MAX_BYTES) throw new ChatVideoError("tooLarge");
  const localUrl = URL.createObjectURL(file);
  const base: PreparedChatVideo = { file, localUrl, posterUrl: null, width: 0, height: 0, sourceDurationMs: 0, trim: null };
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = localUrl;
  const loaded = await new Promise<boolean>((resolve) => {
    const t = window.setTimeout(() => resolve(false), timeoutMs);
    video.onloadedmetadata = () => {
      window.clearTimeout(t);
      resolve(true);
    };
    video.onerror = () => {
      window.clearTimeout(t);
      resolve(false);
    };
  });
  if (!loaded) return base;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const sourceDurationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
  let posterUrl: string | null = null;
  try {
    // A frame a little in (past a fade-in), drawn after the seek lands.
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("seek timeout")), timeoutMs);
      video.onseeked = () => {
        window.clearTimeout(t);
        resolve();
      };
      video.currentTime = Math.min(0.5, (sourceDurationMs || 1000) / 3000);
    });
    if (width > 0 && height > 0) {
      const scale = Math.min(1, 480 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
      if (blob) posterUrl = URL.createObjectURL(blob);
    }
  } catch {
    posterUrl = null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  return { ...base, posterUrl, width, height, sourceDurationMs };
}

/** Releases the object URLs of a prepared video that won't be sent. */
export function releaseChatVideo(video: Pick<PreparedChatVideo, "localUrl" | "posterUrl">): void {
  URL.revokeObjectURL(video.localUrl);
  if (video.posterUrl) URL.revokeObjectURL(video.posterUrl);
}

// ---------------------------------------------------------------------------
// Resumable upload of the original (TUS, Supabase Storage)
// ---------------------------------------------------------------------------

/** Supabase Storage requires exactly this chunk size for TUS (the last chunk may be shorter). */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

function b64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function storageBase(): string {
  return String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function xhr(method: string, url: string, headers: Record<string, string>, body: Blob | null, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<{ status: number; headers: (name: string) => string | null; text: string }> {
  return new Promise((resolve) => {
    const r = new XMLHttpRequest();
    r.open(method, url);
    for (const [k, v] of Object.entries(headers)) r.setRequestHeader(k, v);
    r.timeout = 120_000;
    if (onProgress) r.upload.onprogress = (e) => onProgress(e.loaded);
    r.onload = () => resolve({ status: r.status, headers: (n) => r.getResponseHeader(n), text: r.responseText });
    r.onerror = r.ontimeout = r.onabort = () => resolve({ status: 0, headers: () => null, text: "" });
    signal?.addEventListener("abort", () => r.abort(), { once: true });
    r.send(body);
  });
}

/**
 * Uploads `file` to chat-video-incoming/`path` in 6 MiB chunks. `state`
 * keeps the upload URL, so a retry asks the server how far it got (HEAD)
 * and continues from there. An object already there is our own earlier
 * upload (the path holds this send's fresh message id).
 */
export async function uploadStagedVideo(
  path: string,
  file: Blob,
  state: { uploadUrl?: string },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<"uploaded" | ImageSendFailure> {
  const token = await accessToken();
  if (!token) return "rejected";
  const common = { Authorization: `Bearer ${token}`, apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""), "Tus-Resumable": "1.0.0" };
  let offset = 0;
  if (state.uploadUrl) {
    const head = await xhr("HEAD", state.uploadUrl, common, null, undefined, signal);
    if (head.status >= 200 && head.status < 300) offset = Number(head.headers("Upload-Offset") ?? "0") || 0;
    else state.uploadUrl = undefined; // expired / unknown: start a new upload
  }
  if (!state.uploadUrl) {
    const create = await xhr(
      "POST",
      `${storageBase()}/storage/v1/upload/resumable`,
      {
        ...common,
        "Upload-Length": String(file.size),
        "Upload-Metadata": [
          `bucketName ${b64(CHAT_VIDEO_STAGING_BUCKET)}`,
          `objectName ${b64(path)}`,
          `contentType ${b64(file.type && file.type.startsWith("video/") ? file.type : "video/mp4")}`,
          `cacheControl ${b64("3600")}`,
        ].join(","),
        "x-upsert": "false",
      },
      null,
      undefined,
      signal,
    );
    if (create.status === 409) {
      onProgress(1);
      return "uploaded";
    }
    if (create.status === 401 || create.status === 403) return "rejected";
    if (create.status === 413) return "rejected";
    const location = create.headers("Location");
    if (create.status !== 201 || !location) return create.status === 0 ? "network" : /row-level security|unauthorized/i.test(create.text) ? "rejected" : "network";
    state.uploadUrl = location;
    offset = 0;
  }
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(file.size, offset + TUS_CHUNK_BYTES));
    const start = offset;
    const r = await xhr(
      "PATCH",
      state.uploadUrl!,
      { ...common, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
      chunk,
      (loaded) => onProgress(Math.min(1, (start + loaded) / file.size)),
      signal,
    );
    if (r.status === 409) {
      // Offset mismatch: ask where the server is and continue from there.
      const head = await xhr("HEAD", state.uploadUrl!, common, null, undefined, signal);
      const at = Number(head.headers("Upload-Offset") ?? "NaN");
      if (!Number.isFinite(at)) return "network";
      offset = at;
      continue;
    }
    if (r.status === 401 || r.status === 403) return "rejected";
    if (r.status < 200 || r.status >= 300) return "network";
    offset = Number(r.headers("Upload-Offset") ?? String(start + chunk.size)) || start + chunk.size;
  }
  onProgress(1);
  return "uploaded";
}

// ---------------------------------------------------------------------------
// The transcoder
// ---------------------------------------------------------------------------

export interface ProcessedVideoResult {
  videoPath: string;
  posterPath: string;
  width: number;
  height: number;
  durationMs: number;
}

/** POST /api/chat-video as the signed-in golfer. Same origin: the web app and the native app (it loads the live site) both reach it. */
export async function processChatVideo(input: {
  scope: ChatScope;
  scopeId: string;
  messageId: string;
  index: number;
  stagedPath: string;
  trim: { startMs: number; endMs: number } | null;
}): Promise<{ ok: true; result: ProcessedVideoResult } | { ok: false; failure: ImageSendFailure; stagedMissing: boolean }> {
  const token = await accessToken();
  if (!token) return { ok: false, failure: "rejected", stagedMissing: false };
  let res: Response;
  try {
    res = await fetch("/api/chat-video", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, failure: "network", stagedMissing: false };
  }
  let body: Partial<ProcessedVideoResult> & { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  const outcome = classifyVideoProcess(res.status, body.error);
  if (outcome !== "ok") return { ok: false, failure: outcome, stagedMissing: body.error === "staged_missing" };
  if (!body.videoPath || !body.posterPath || !body.width || !body.height || !body.durationMs) return { ok: false, failure: "network", stagedMissing: false };
  return { ok: true, result: body as ProcessedVideoResult };
}

/**
 * Stores every item of an album / video send that isn't stored yet, in
 * order: a photo is uploaded to chat-video; a video's original is uploaded
 * (resumable) to chat-video-incoming, then transcoded into chat-video.
 * Mutates `items` (progress, staged, uploadUrl, done, result) so a retry
 * resumes exactly where this attempt stopped: stored items are never sent
 * twice. `onChange` runs when an item's shown progress step changes.
 */
export async function storeMediaItems(
  items: MediaSendItem[],
  ctx: { scope: ChatScope; scopeId: string; messageId: string; userId: string },
  onChange: () => void,
): Promise<"uploaded" | ImageSendFailure> {
  const prefix = mediaPrefix(ctx.scope, ctx.scopeId, ctx.messageId);
  const shown = items.map(() => -1);
  const report = (i: number, fraction: number) => {
    items[i].progress = fraction;
    const step = progressStep(fraction);
    if (step !== shown[i]) {
      shown[i] = step;
      onChange();
    }
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.done) continue;
    if (it.kind === "image") {
      const r = await uploadAlbumPhoto(mediaItemPath(prefix, i, "image"), it.blob, (f) => report(i, f));
      if (r !== "uploaded") return r;
    } else {
      const staged = stagedVideoPath(ctx.userId, ctx.messageId, i);
      if (!it.staged) {
        const r = await uploadStagedVideo(staged, it.blob, it, (f) => report(i, f * 0.8));
        if (r !== "uploaded") return r;
        it.staged = true;
      }
      report(i, 0.9);
      const p = await processChatVideo({ scope: ctx.scope, scopeId: ctx.scopeId, messageId: ctx.messageId, index: i, stagedPath: staged, trim: it.trim });
      if (!p.ok) {
        // The original is gone (swept, or removed): upload it again next time.
        if (p.stagedMissing) {
          it.staged = false;
          it.uploadUrl = undefined;
        }
        return p.failure;
      }
      it.result = { width: p.result.width, height: p.result.height, durationMs: p.result.durationMs };
    }
    it.done = true;
    report(i, 1);
  }
  return "uploaded";
}

/** Every object a (partly) stored send left behind: the stored items and any staged original. */
export async function removeUnsentMedia(items: readonly MediaSendItem[], ctx: { scope: ChatScope; scopeId: string; messageId: string; userId: string }): Promise<void> {
  const prefix = mediaPrefix(ctx.scope, ctx.scopeId, ctx.messageId);
  const stored: string[] = [];
  items.forEach((it, i) => {
    if (it.done) {
      stored.push(mediaItemPath(prefix, i, it.kind));
      if (it.kind === "video") stored.push(mediaPosterPath(prefix, i));
    } else if (it.kind === "video" && it.staged) {
      void removeStagedVideo(stagedVideoPath(ctx.userId, ctx.messageId, i));
    }
  });
  await removeChatVideoObjects(stored);
}

/** After a successful send: this device shows its own photos and posters from the local copies (never re-downloaded). */
export function keepLocalMediaCopies(items: readonly MediaSendItem[], prefix: string): void {
  const urls = chatVideoUrls();
  items.forEach((it, i) => {
    if (it.kind === "image") urls.setLocal(mediaItemPath(prefix, i, "image"), it.localUrl);
    else if (it.posterUrl) urls.setLocal(mediaPosterPath(prefix, i), it.posterUrl);
  });
}

/** An album photo (already re-encoded on the device) into chat-video. */
export function uploadAlbumPhoto(path: string, blob: Blob, onProgress: (fraction: number) => void): Promise<"uploaded" | ImageSendFailure> {
  return uploadChatImage(path, blob, onProgress, undefined, "image/jpeg", "chat-video");
}

/**
 * Best effort: removes my own objects after an unsend or a discarded send.
 * The bucket's delete policy only allows my own objects no row points at.
 * Leftovers are swept by chat-video-retention after a day.
 */
export async function removeChatVideoObjects(names: readonly string[]): Promise<void> {
  const real = names.filter((n) => n && !isDemoMediaPath(n) && !n.startsWith("pending/"));
  if (real.length === 0) return;
  try {
    const { error } = await supabase.storage.from(CHAT_VIDEO_BUCKET).remove([...real]);
    if (error) console.error("GolfMe: couldn't remove chat media.", error.message);
  } catch (err) {
    console.error("GolfMe: couldn't remove chat media.", err);
  }
}

export async function removeStagedVideo(path: string): Promise<void> {
  try {
    await supabase.storage.from(CHAT_VIDEO_STAGING_BUCKET).remove([path]);
  } catch {
    // swept after a day
  }
}

// ---------------------------------------------------------------------------
// Signed URLs for chat-video (one cache for the app, in memory)
// ---------------------------------------------------------------------------

let cache: ChatImageUrlCache | null = null;

export function chatVideoUrls(): ChatImageUrlCache {
  if (!cache) {
    cache = createChatImageUrlCache({
      ttlSeconds: CHAT_VIDEO_URL_TTL_S,
      sign: async (paths, ttl) => {
        const real = paths.filter((p) => !isDemoMediaPath(p) && !p.startsWith("pending/"));
        if (real.length === 0) return paths.map((path) => ({ path, url: null }));
        const { data, error } = await supabase.storage.from(CHAT_VIDEO_BUCKET).createSignedUrls(real, ttl);
        if (error || !data) return paths.map((path) => ({ path, url: null }));
        const byPath = new Map(data.map((d) => [d.path ?? "", d.error ? null : d.signedUrl]));
        return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
      },
    });
  }
  return cache;
}

/** Sign-out / account switch. */
export function resetChatVideoUrls(): void {
  if (!cache) return;
  for (const url of cache.reset()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}
