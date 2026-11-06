// Photos in chat (DMs and round group chats): the rules that don't need a
// browser. Storage paths, sizes, the encode ladder, feature detection, the
// composer attachment state machine, the pending-upload state, previews and
// the EXIF check. No React / DOM / Supabase imports, so
// tests/chatImages.test.ts runs it under plain node.
//
// Storage (migration 20261107170000_chat_images): one PRIVATE bucket,
// chat-media, one JPEG per message at
//   dm/<conversation_id>/<message_id>.jpg
//   round/<round_id>/<message_id>.jpg
// The message id is made on the device BEFORE the upload, so the object can
// be put at its final path first and the message row (carrying that same id
// and path) inserted after. The database refuses a row whose path doesn't
// spell out its own conversation/round and id, or whose object wasn't
// uploaded by the sender. Viewers get short-lived signed URLs
// (lib/chatImageUrlCache.ts); nothing public, nothing persisted.

export const CHAT_MEDIA_BUCKET = "chat-media";

/** Long edge cap (px) after re-encoding. */
export const CHAT_IMAGE_MAX_EDGE = 2048;
/** Upload cap; also the bucket's file_size_limit (2 MiB). */
export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Database limit on the stored width / height (the client never goes past CHAT_IMAGE_MAX_EDGE). */
export const CHAT_IMAGE_DB_MAX_EDGE = 4096;
/** Long edge of the tiny placeholder stored with the row (a ~16 px JPEG data URL). */
export const CHAT_THUMB_EDGE = 16;
/** The database refuses a longer placeholder. */
export const CHAT_THUMB_MAX_CHARS = 2048;
/** Signed URL lifetime (seconds). Short: a leaked link dies quickly; the cache re-signs before expiry. */
export const CHAT_IMAGE_URL_TTL_S = 600;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^(dm|round)/(${UUID})/(${UUID})\\.jpg$`);
const UUID_RE = new RegExp(`^${UUID}$`);

export type ChatImageScope = "dm" | "round";

function assertUuid(value: string, what: string): string {
  const v = value.toLowerCase();
  if (!UUID_RE.test(v)) throw new Error(`chat image path: ${what} is not a uuid`);
  return v;
}

/** dm/<conversation_id>/<message_id>.jpg (lowercase, as Postgres prints uuids). */
export function dmImagePath(conversationId: string, messageId: string): string {
  return `dm/${assertUuid(conversationId, "conversation id")}/${assertUuid(messageId, "message id")}.jpg`;
}

/** round/<round_id>/<message_id>.jpg */
export function roundImagePath(roundId: string, messageId: string): string {
  return `round/${assertUuid(roundId, "round id")}/${assertUuid(messageId, "message id")}.jpg`;
}

export function parseChatImagePath(path: string): { scope: ChatImageScope; scopeId: string; messageId: string } | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  return { scope: m[1] as ChatImageScope, scopeId: m[2], messageId: m[3] };
}

/** Demo account photos live only in this page's memory (object URLs), under this prefix. */
export const DEMO_IMAGE_PREFIX = "demo-image/";
/** Also true for demo voice recordings (lib/chatVoice.ts DEMO_VOICE_PREFIX): never signed. */
export function isDemoImagePath(path: string): boolean {
  return path.startsWith(DEMO_IMAGE_PREFIX) || path.startsWith("demo-voice/");
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/** Scales (w, h) down so the long edge is at most maxEdge (never up). Rounded, at least 1 px. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// JPEG encode attempts, in order, until one is at most CHAT_IMAGE_MAX_BYTES:
// quality first (cheap, keeps resolution), then the long edge shrinks.
// A 2048 px photo at 0.85 is usually 0.5-1.5 MB, so the first step almost
// always wins; the rest is for very detailed / noisy shots.
export interface EncodeStep {
  maxEdge: number;
  quality: number;
}
export const ENCODE_LADDER: readonly EncodeStep[] = [
  { maxEdge: 2048, quality: 0.85 },
  { maxEdge: 2048, quality: 0.72 },
  { maxEdge: 2048, quality: 0.6 },
  { maxEdge: 1600, quality: 0.6 },
  { maxEdge: 1280, quality: 0.6 },
  { maxEdge: 1024, quality: 0.55 },
];

/**
 * Bubble size for a photo (CSS px) that keeps its aspect ratio inside the
 * bubble's box. Computed from the stored width/height only, so the space is
 * reserved before any pixel arrives and the list never jumps when the photo
 * loads (the threads' scroll anchoring depends on that).
 */
export function chatImageDisplaySize(width: number, height: number, maxWidth = 240, maxHeight = 320, minEdge = 96): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: maxWidth, height: Math.round(maxWidth * 0.75) };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  // A very thin panorama / strip would be a sliver: each edge keeps at
  // least minEdge (the photo is then cropped by object-cover, centred).
  const w = Math.min(maxWidth, Math.max(minEdge, width * scale));
  const h = Math.min(maxHeight, Math.max(minEdge, height * scale));
  return { width: Math.round(w), height: Math.round(h) };
}

// ---------------------------------------------------------------------------
// The image a message carries
// ---------------------------------------------------------------------------

export interface ChatImageRef {
  /** Storage path (real accounts) or a demo-image/... key. */
  path: string;
  width: number;
  height: number;
  /** Tiny JPEG data URL placeholder (blurred while the photo loads). */
  thumb?: string | null;
}

export interface ImageRowColumns {
  image_path?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_thumb?: string | null;
}

/** The image a fetched messages / round_messages row carries, or null. */
export function imageFromRow(row: ImageRowColumns): ChatImageRef | null {
  if (!row.image_path || !row.image_width || !row.image_height) return null;
  return { path: row.image_path, width: row.image_width, height: row.image_height, thumb: row.image_thumb ?? null };
}

/** Row columns for an insert. */
export function imageRowColumns(image: ChatImageRef): Required<ImageRowColumns> {
  return {
    image_path: image.path,
    image_width: Math.round(image.width),
    image_height: Math.round(image.height),
    image_thumb: image.thumb && isValidThumb(image.thumb) ? image.thumb : null,
  };
}

const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
/** Same rule as the database's check constraint. */
export function isValidThumb(thumb: string): boolean {
  return thumb.length <= CHAT_THUMB_MAX_CHARS && THUMB_RE.test(thumb);
}

// ---------------------------------------------------------------------------
// Feature detection (the client ships before the migration)
// ---------------------------------------------------------------------------

/** A fetched row (selected with "*") carries image_path, i.e. the migration is applied. */
export function rowsHaveImageColumn(rows: readonly object[]): boolean {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, "image_path"));
}

/**
 * The column / bucket isn't there yet: PostgREST PGRST204 (unknown column in
 * an insert), Postgres 42703 (undefined column in a select), or the error
 * names image_path. Storage's "Bucket not found" counts too.
 */
export function isMissingImageSupportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message, statusCode } = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const msg = typeof message === "string" ? message : "";
  if ((code === "PGRST204" || code === "42703") && (msg === "" || /image_(path|width|height|thumb)/.test(msg))) return true;
  if (/image_path/.test(msg) && /column/i.test(msg)) return true;
  return (statusCode === "404" || statusCode === 404) && /bucket not found/i.test(msg);
}

export type ImageSupport = "unknown" | "yes" | "no";

/**
 * Whether the photo button shows. Demo: always (page-local photos). Real:
 * only once the database is known to have the image columns (a fetched row
 * carries them, or the one-row probe succeeded), and never after a send
 * proved them missing.
 */
export function imagesAvailable(input: { isDemo: boolean; rowsHaveColumn: boolean; probe: ImageSupport; latchedMissing: boolean }): boolean {
  if (input.isDemo) return true;
  if (input.latchedMissing) return false;
  return input.rowsHaveColumn || input.probe === "yes";
}

// ---------------------------------------------------------------------------
// Composer attachment (one photo per message)
// ---------------------------------------------------------------------------

export interface ProcessedChatImage {
  blob: Blob;
  width: number;
  height: number;
  thumb: string | null;
  /** Object URL of `blob` for the preview chip / the sending bubble. */
  previewUrl: string;
}

export type AttachmentState =
  | { kind: "none" }
  | { kind: "processing"; key: string }
  | { kind: "ready"; key: string; image: ProcessedChatImage };

export type AttachmentEvent =
  | { type: "pick"; key: string }
  | { type: "processed"; key: string; image: ProcessedChatImage }
  | { type: "failed"; key: string }
  | { type: "remove" }
  | { type: "sent" };

/**
 * One photo at a time. A newer pick replaces whatever is there (a result for
 * an older pick is ignored), remove / sent clear it. Returns the same object
 * when nothing changes. The caller revokes the preview URL of a replaced or
 * removed photo (not of a sent one: the sending bubble keeps using it).
 */
export function attachmentReducer(state: AttachmentState, event: AttachmentEvent): AttachmentState {
  switch (event.type) {
    case "pick":
      return { kind: "processing", key: event.key };
    case "processed":
      return state.kind === "processing" && state.key === event.key ? { kind: "ready", key: event.key, image: event.image } : state;
    case "failed":
      return state.kind === "processing" && state.key === event.key ? { kind: "none" } : state;
    case "remove":
    case "sent":
      return state.kind === "none" ? state : { kind: "none" };
  }
}

/** Send is possible: text, or a processed photo (not one still processing). */
export function canSendDraft(text: string, attachment: AttachmentState): boolean {
  if (attachment.kind === "processing") return false;
  return text.trim() !== "" || attachment.kind === "ready";
}

/**
 * What ChatComposer's one-send-per-draft guard (lib/sendGuard.ts) compares:
 * the text, plus the photo's key when there is one, so a photo-only send
 * is still "a draft" and the same photo can't go twice.
 */
export function draftSendKey(text: string, attachmentKey: string | null): string {
  return attachmentKey ? `\u0000photo:${attachmentKey}\u0000${text}` : text;
}

// ---------------------------------------------------------------------------
// Sending (upload, then the row)
// ---------------------------------------------------------------------------

// sending   upload or insert in flight (progress 0..1 is the upload's)
// failed    "Not sent": Retry / Discard. `failure` says whether a retry can help.
// A photo send that succeeds is handed over to the normal sent / reconcile
// path of each chat (a sent pending message until its row arrives).
export type ImageSendFailure = "network" | "rejected" | "objectionable";

export interface UploadOutcome {
  ok: boolean;
  /** HTTP status (0 = no response). */
  status: number;
  /** Storage's own error text, if any. */
  message?: string;
}

/**
 * Storage upload result -> what to do. An object already at our path is our
 * own earlier attempt (the path holds our fresh message id, and the insert
 * policy only lets this sender put it there), so it counts as uploaded.
 * 401/403 = the policy refused (not in the chat any more, a block, the round
 * ended): no retry will help until that changes. Anything else: network.
 */
export function classifyUpload(outcome: UploadOutcome): "uploaded" | ImageSendFailure {
  if (outcome.ok) return "uploaded";
  const msg = outcome.message ?? "";
  if (outcome.status === 409 || /duplicate|already exists/i.test(msg)) return "uploaded";
  if (outcome.status === 401 || outcome.status === 403 || /row-level security|unauthorized/i.test(msg)) return "rejected";
  return "network";
}

/**
 * The row insert's error -> what to do. 23505 on the primary key means an
 * earlier attempt's insert did land (its answer was lost): already sent.
 */
export function classifyImageInsertError(error: unknown): "sent" | ImageSendFailure {
  if (!error || typeof error !== "object") return "network";
  const { code, hint, message } = error as { code?: unknown; hint?: unknown; message?: unknown };
  if (code === "23505") return "sent";
  if (hint === "objectionable_content" || (typeof message === "string" && message.includes("objectionable_content"))) return "objectionable";
  if (code === "42501" || hint === "image_not_uploaded" || hint === "audio_not_uploaded") return "rejected";
  return "network";
}

/** Progress steps worth a re-render (every 10%, plus the start and the end). */
export function progressStep(fraction: number): number {
  if (!(fraction > 0)) return 0;
  if (fraction >= 1) return 1;
  return Math.floor(fraction * 10) / 10;
}

// ---------------------------------------------------------------------------
// Text for previews (Inbox row, reply quote, reply bar, push)
// ---------------------------------------------------------------------------

/**
 * What a message reads as in one line: its text, or the photo label when it
 * is a photo with no text. A photo with a caption reads "<label> <caption>".
 */
export function messagePreviewText(
  m: { text: string; image?: ChatImageRef | null; voice?: { path: string; durationMs: number } | null },
  photoLabel: string,
  voiceLabel = "[Voice message]",
): string {
  const text = m.text.trim();
  // A voice message (lib/chatVoice.ts) has no caption.
  if (m.voice) return text ? `${voiceLabel} ${text}` : voiceLabel;
  if (!m.image) return m.text;
  return text ? `${photoLabel} ${text}` : photoLabel;
}

// ---------------------------------------------------------------------------
// EXIF (privacy check)
// ---------------------------------------------------------------------------

/**
 * Whether JPEG bytes carry an EXIF block (APP1 "Exif\0\0", where GPS and
 * camera data live) or an XMP block (APP1 "http://ns.adobe.com/xap/").
 * Canvas re-encoding writes neither; this lets tests (and a debug check)
 * prove it on the actual bytes.
 */
export function jpegMetadataSegments(bytes: Uint8Array): { exif: boolean; xmp: boolean; isJpeg: boolean } {
  const result = { exif: false, xmp: false, isJpeg: false };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return result;
  result.isJpeg = true;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    // Standalone markers without a length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end: no more headers
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    if (marker === 0xe1) {
      const start = i + 4;
      const head = String.fromCharCode(...bytes.subarray(start, Math.min(start + 29, bytes.length)));
      if (head.startsWith("Exif\u0000")) result.exif = true;
      if (head.startsWith("http://ns.adobe.com/xap/")) result.xmp = true;
    }
    i += 2 + len;
  }
  return result;
}
