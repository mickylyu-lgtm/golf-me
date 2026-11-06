// Video playback helpers shared by every Community video surface (Swing Post
// feed video, the photo/video carousel, the fullscreen viewer). Pure (no
// imports) so tests/videoPlayback.test.ts runs it under node --test.
//
// Why this exists: a <video> that fails (dead link, an HTTP error, a codec
// the device can't decode) just stays black in WebKit — no message, no way
// out. These helpers decide what the viewer is told and whether a Retry
// makes sense, from what the browser and one cheap HEAD probe report.
//
// URL policy: Community media lives in the PUBLIC community-media bucket,
// whose /object/public/ URLs are permanent and identical for every viewer
// (storage RLS is never consulted for them). So a Community video never
// needs a per-viewer signed URL. If an old row ever stored a signed or
// authenticated link INTO that public bucket, it is rewritten to the
// permanent public URL at render time (rows are never changed). A signed
// link into a PRIVATE bucket (caddie-media) is left alone: only its owner
// may mint a fresh one, so for anyone else it is "unavailable", by design.

export type VideoFailure = "network" | "unavailable" | "unsupported";

/** Buckets whose objects are served at /object/public/ to everyone. */
export const PUBLIC_MEDIA_BUCKETS: readonly string[] = ["community-media"];

/** No progress this long after a play/load attempt = treat as a network failure (never an infinite spinner). */
export const VIDEO_STALL_TIMEOUT_MS = 20_000;
/** The loading spinner only appears after this, so a quick start never flickers one. */
export const VIDEO_SPINNER_DELAY_MS = 500;

// HTMLMediaElement.error.code values (MediaError constants).
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export interface StorageUrlParts {
  /** Everything before /storage/v1/object/ (the project origin). */
  origin: string;
  access: "public" | "sign" | "authenticated";
  bucket: string;
  /** Object path inside the bucket, still URL-encoded as it appeared. */
  path: string;
  /** "#..." fragment, if any (e.g. "#t=1"). */
  hash: string;
}

const STORAGE_RE = /^(https?:\/\/[^/]+)\/storage\/v1\/object\/(public|sign|authenticated)\/([^/?#]+)\/([^?#]+)(\?[^#]*)?(#.*)?$/;

/** Splits a Supabase Storage object URL; null for anything else (blob:, data:, other hosts' URLs). */
export function parseStorageUrl(url: string | null | undefined): StorageUrlParts | null {
  if (!url) return null;
  const m = STORAGE_RE.exec(url);
  if (!m) return null;
  return { origin: m[1], access: m[2] as StorageUrlParts["access"], bucket: m[3], path: m[4], hash: m[6] ?? "" };
}

/**
 * The URL a viewer should actually load for a Community video. Public
 * bucket objects always resolve to their permanent public URL (dropping any
 * stored token, which would expire or belong to someone else). Everything
 * else is returned unchanged.
 */
export function resolveCommunityMediaUrl(url: string | undefined, publicBuckets: readonly string[] = PUBLIC_MEDIA_BUCKETS): string | undefined {
  if (!url) return url;
  const parts = parseStorageUrl(url);
  if (!parts || parts.access === "public" || !publicBuckets.includes(parts.bucket)) return url;
  return `${parts.origin}/storage/v1/object/public/${parts.bucket}/${parts.path}${parts.hash}`;
}

/** True for a signed link into a bucket that is not public (it can only ever work until it expires, and only its owner can re-sign it). */
export function isPrivateSignedUrl(url: string | undefined, publicBuckets: readonly string[] = PUBLIC_MEDIA_BUCKETS): boolean {
  const parts = parseStorageUrl(url);
  return !!parts && parts.access !== "public" && !publicBuckets.includes(parts.bucket);
}

/**
 * Expiry (ms since epoch) of a Supabase signed URL, read from its token's
 * `exp` claim; null when there is no readable token. Only the public
 * payload half of the token is decoded — nothing is verified or logged.
 */
export function signedUrlExpiresAt(url: string | undefined): number | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q < 0) return null;
  const token = new URLSearchParams(url.slice(q + 1).split("#")[0]).get("token");
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const exp = (JSON.parse(atob(b64)) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * With no usable poster, WebKit (iOS Safari / the app's WKWebView) paints
 * nothing for a `preload="metadata"` video until it plays — a black box
 * whenever autoplay is refused (Low Power Mode, Low Data Mode). A tiny
 * media-fragment start makes it decode and paint the first frame instead.
 * A URL that already has a fragment is left as is.
 */
export function withFirstFrameHint(url: string | undefined, hasPoster: boolean): string | undefined {
  if (!url || hasPoster || url.includes("#") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `${url}#t=0.001`;
}

/** What a HEAD probe of the video URL found (undefined = no probe ran). */
export type ProbeResult = { kind: "status"; status: number } | { kind: "network-error" } | undefined;

/**
 * Decides what to tell the viewer about a failed video.
 *  - The server says the file is gone or not theirs (400 bad/expired token,
 *    401/403, 404, 410), or it is an expired private signed link: unavailable,
 *    and retrying can't help.
 *  - The request itself failed, the server erred (5xx), throttled (429), or
 *    timed out (408), or the browser reports a network error: network, retry.
 *  - The file is reachable (2xx) but the browser couldn't decode it or
 *    doesn't support it: unsupported on this device (e.g. a 10-bit HDR/HEVC
 *    or high-frame-rate clip an older iPhone can't decode). No retry.
 */
export function classifyVideoFailure(input: {
  mediaErrorCode?: number | null;
  probe?: ProbeResult;
  stalled?: boolean;
  expiredPrivateLink?: boolean;
}): VideoFailure {
  const { mediaErrorCode, probe, stalled, expiredPrivateLink } = input;
  if (expiredPrivateLink) return "unavailable";
  if (probe?.kind === "status") {
    const s = probe.status;
    if (s === 400 || s === 401 || s === 403 || s === 404 || s === 410) return "unavailable";
    if (s === 408 || s === 429 || s >= 500) return "network";
    if (s >= 200 && s < 300) {
      if (mediaErrorCode === MEDIA_ERR_DECODE || mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED) return "unsupported";
      return "network";
    }
  }
  if (probe?.kind === "network-error" || stalled) return "network";
  if (mediaErrorCode === MEDIA_ERR_DECODE) return "unsupported";
  // SRC_NOT_SUPPORTED without a probe is ambiguous (WebKit also reports it
  // for an HTTP error page), so it gets the retryable answer.
  return "network";
}

/** Only a network failure is worth a Retry; an unavailable or undecodable file never is (no retry loop). */
export function canRetryVideo(failure: VideoFailure): boolean {
  return failure === "network";
}

/** i18n key for each failure's message. */
export function videoFailureMessageKey(failure: VideoFailure): "media.videoNetworkError" | "media.videoUnavailable" | "media.videoUnsupported" {
  return failure === "network" ? "media.videoNetworkError" : failure === "unavailable" ? "media.videoUnavailable" : "media.videoUnsupported";
}
