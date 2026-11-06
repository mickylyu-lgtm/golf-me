// Browser side of chat photos: re-encoding on the device, the upload (with
// progress), removal after unsend, the shared signed-URL cache and copying a
// photo to the clipboard. The rules live in lib/chatImages.ts.
import { supabase } from "./supabase";
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_URL_TTL_S,
  CHAT_MEDIA_BUCKET,
  CHAT_THUMB_EDGE,
  ENCODE_LADDER,
  classifyUpload,
  fitWithin,
  isDemoImagePath,
  isValidThumb,
  type ImageSendFailure,
  type ProcessedChatImage,
} from "./chatImages";
import { createChatImageUrlCache, type ChatImageUrlCache } from "./chatImageUrlCache";

// ---------------------------------------------------------------------------
// Re-encode on the device
// ---------------------------------------------------------------------------

export class ChatImageError extends Error {
  readonly reason: "unreadable" | "tooLarge";
  constructor(reason: "unreadable" | "tooLarge") {
    super(reason);
    this.reason = reason;
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

// EXIF orientation is applied while decoding (createImageBitmap's
// "from-image", and <img>'s default image-orientation), so a portrait
// iPhone photo comes out upright even though its rotation flag, like all
// its other EXIF data, is dropped by the re-encode.
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older WebKit rejects the option (or the format): try <img> below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new ChatImageError("unreadable"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new ChatImageError("unreadable");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof ChatImageError ? err : new ChatImageError("unreadable");
  }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ChatImageError("unreadable");
  // JPEG has no alpha: a transparent PNG/screenshot would turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ChatImageError("unreadable"))), "image/jpeg", quality),
  );
}

/**
 * Picked file -> a fresh JPEG (long edge <= 2048 px, <= 2 MB) drawn on a
 * canvas, plus a ~16 px placeholder. Only pixels survive a canvas: EXIF
 * (GPS location, camera, time), XMP and any other metadata of the original
 * are never in the bytes that are uploaded. iPhone HEIC: the picker hands
 * WKWebView / Safari a JPEG for accept="image/*", and recent WebKit decodes
 * HEIC itself anyway; a browser that can't decode the file gets "unreadable".
 */
export async function processChatImage(file: Blob): Promise<ProcessedChatImage> {
  if (file.type && !file.type.startsWith("image/")) throw new ChatImageError("unreadable");
  const decoded = await decode(file);
  try {
    let blob: Blob | null = null;
    let size = { width: 0, height: 0 };
    for (const step of ENCODE_LADDER) {
      size = fitWithin(decoded.width, decoded.height, step.maxEdge);
      const candidate = await toJpeg(draw(decoded.source, size.width, size.height), step.quality);
      if (candidate.size <= CHAT_IMAGE_MAX_BYTES) {
        blob = candidate;
        break;
      }
    }
    if (!blob) throw new ChatImageError("tooLarge");
    let thumb: string | null = null;
    try {
      const t = fitWithin(decoded.width, decoded.height, CHAT_THUMB_EDGE);
      const data = draw(decoded.source, t.width, t.height).toDataURL("image/jpeg", 0.5);
      thumb = isValidThumb(data) ? data : null;
    } catch {
      thumb = null;
    }
    return { blob, width: size.width, height: size.height, thumb, previewUrl: URL.createObjectURL(blob) };
  } finally {
    decoded.close();
  }
}

// ---------------------------------------------------------------------------
// Upload / remove (real accounts)
// ---------------------------------------------------------------------------

/**
 * Uploads the JPEG to chat-media at `path` as the signed-in user (never
 * upsert: an object can't be replaced). XMLHttpRequest rather than
 * supabase-js, only for upload progress; same endpoint and headers.
 */
// Also uploads voice recordings (lib/chatVoice.ts): contentType "audio/mp4"
// or "audio/webm", the bucket's other two allowed types.
export async function uploadChatImage(
  path: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  contentType: "image/jpeg" | "audio/mp4" | "audio/webm" = "image/jpeg",
  // Album photos go to chat-video (lib/chatMedia.ts), same rules.
  bucket: "chat-media" | "chat-video" = CHAT_MEDIA_BUCKET,
): Promise<"uploaded" | ImageSendFailure> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "rejected";
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const url = `${base}/storage/v1/object/${bucket}/${path}`;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""));
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { statusCode?: string | number; message?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        body = {};
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      // Storage puts its own status in the body (often with HTTP 400).
      const status = ok ? xhr.status : Number(body.statusCode ?? xhr.status) || xhr.status;
      if (ok) onProgress(1);
      resolve(classifyUpload({ ok, status, message: `${body.error ?? ""} ${body.message ?? ""}`.trim() }));
    };
    xhr.onerror = () => resolve("network");
    xhr.ontimeout = () => resolve("network");
    xhr.onabort = () => resolve("network");
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Best effort: removes my own photo after an unsend, a discarded failed send
 * or a send that never got its row. The bucket's delete policy only allows
 * my own objects that no live message points at, so this can't take down a
 * photo that is still showing in a chat. A failure leaves an orphan only I
 * can read (purge query in the migration header).
 */
export async function removeChatImage(path: string | null | undefined): Promise<void> {
  if (!path || isDemoImagePath(path)) return;
  try {
    const { error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([path]);
    if (error) console.error("GolfMe: couldn't remove a chat photo.", error.message);
  } catch (err) {
    console.error("GolfMe: couldn't remove a chat photo.", err);
  }
}

// ---------------------------------------------------------------------------
// Signed URLs (one cache for the whole app, in memory)
// ---------------------------------------------------------------------------

let cache: ChatImageUrlCache | null = null;

export function chatImageUrls(): ChatImageUrlCache {
  if (!cache) {
    cache = createChatImageUrlCache({
      ttlSeconds: CHAT_IMAGE_URL_TTL_S,
      sign: async (paths, ttl) => {
        const real = paths.filter((p) => !isDemoImagePath(p));
        if (real.length === 0) return paths.map((path) => ({ path, url: null }));
        const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrls(real, ttl);
        if (error || !data) return paths.map((path) => ({ path, url: null }));
        const byPath = new Map(data.map((d) => [d.path ?? "", d.error ? null : d.signedUrl]));
        return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
      },
    });
  }
  return cache;
}

/** Sign-out / account switch: drop every signed URL and local photo. */
export function resetChatImageUrls(): void {
  if (!cache) return;
  for (const url of cache.reset()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Copy a photo
// ---------------------------------------------------------------------------

/** The platform can put an image on the clipboard (async Clipboard API with image/png). */
export function canCopyImages(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: { supports?: (type: string) => boolean } }).ClipboardItem;
  if (!ClipboardItemCtor || typeof navigator.clipboard?.write !== "function") return false;
  return typeof ClipboardItemCtor.supports === "function" ? ClipboardItemCtor.supports("image/png") : true;
}

async function pngFrom(getUrl: () => Promise<string | null>): Promise<Blob> {
  const url = await getUrl();
  if (!url) throw new Error("photo unavailable");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const decoded = await decode(await res.blob());
  try {
    const canvas = draw(decoded.source, decoded.width, decoded.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/png"));
  } finally {
    decoded.close();
  }
}

/**
 * Copies the photo (as PNG, the one image type browsers accept on the
 * clipboard), with the caption as text when there is one. Must be called
 * straight from the tap: the ClipboardItem is created synchronously with a
 * promised blob (WebKit's rule for gesture-gated clipboard writes).
 */
export async function copyChatImage(path: string, localUrl: string | null | undefined, caption: string): Promise<boolean> {
  try {
    const ClipboardItemCtor = (window as unknown as { ClipboardItem: new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem }).ClipboardItem;
    const getUrl = () => (localUrl ? Promise.resolve(localUrl) : chatImageUrls().get(path));
    const items: Record<string, Blob | Promise<Blob>> = { "image/png": pngFrom(getUrl) };
    if (caption.trim()) items["text/plain"] = new Blob([caption], { type: "text/plain" });
    await navigator.clipboard.write([new ClipboardItemCtor(items)]);
    return true;
  } catch (err) {
    console.error("GolfMe: couldn't copy the photo.", err);
    return false;
  }
}
