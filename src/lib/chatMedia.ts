// Videos and albums in chat (DMs and round group chats; migration
// 20261107220000_chat_video_albums): the rules that don't need a browser.
// Paths, the row's `media` array, feature detection, the composer's
// multi-item attachment list, per-item send state, previews and the deck's
// gesture math. No React / DOM / Supabase imports, so
// tests/chatMedia.test.ts runs it under plain node.
//
// Model: a message carries at most one of image_path (a single photo,
// unchanged since 20261107170000), audio_path (voice, 20261107180000) or
// `media`: an ordered array of 1..10 items. A single video is a 1-item
// array; an album is 2..10 photos and videos. Every media item lives in the
// private chat-video bucket at
//   <scope>/<scope id>/<message id>/<i>.jpg         an album photo
//   <scope>/<scope id>/<message id>/<i>.mp4         a video (transcoded on our server)
//   <scope>/<scope id>/<message id>/<i>.poster.jpg  its poster frame
// so a path is a pure function of the message and the item's position, and
// the database checks exactly that. A video's original is uploaded first to
// chat-video-incoming/<user id>/<message id>-<i>.orig (resumable, <= 200 MiB),
// api/chat-video.ts turns it into the .mp4 + poster, and only then is the row
// inserted. After 180 days a video item becomes {kind:"video", expired:true}
// (the bubble says "Video expired").

import type { ImageSendFailure, ProcessedChatImage } from "./chatImages.ts";

export const CHAT_VIDEO_BUCKET = "chat-video";
export const CHAT_VIDEO_STAGING_BUCKET = "chat-video-incoming";
/** Items per message (the database's limit). */
export const MEDIA_MAX_ITEMS = 10;
/** Longest video sent (the trim selector opens past this). */
export const VIDEO_MAX_MS = 60_000;
/** Database limit on a stored duration (a little over the max for rounding). */
export const VIDEO_DB_MAX_MS = 61_000;
/** chat-video-incoming's file_size_limit. */
export const VIDEO_STAGED_MAX_BYTES = 200 * 1024 * 1024;
/** Signed URL lifetime for chat-video (videos play for a while; re-signed on error). */
export const CHAT_VIDEO_URL_TTL_S = 1800;
/** Demo account media lives only in this page's memory, under this prefix. */
export const DEMO_MEDIA_PREFIX = "demo-media/";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export type ChatScope = "dm" | "round";
export type ChatMediaKind = "image" | "video";

function uuid(value: string, what: string): string {
  const v = value.toLowerCase();
  if (!UUID_RE.test(v)) throw new Error(`chat media path: ${what} is not a uuid`);
  return v;
}

/** dm/<conversation>/<message> or round/<round>/<message>. */
export function mediaPrefix(scope: ChatScope, scopeId: string, messageId: string): string {
  return `${scope}/${uuid(scopeId, "scope id")}/${uuid(messageId, "message id")}`;
}
export function mediaItemPath(prefix: string, index: number, kind: ChatMediaKind): string {
  return `${prefix}/${index}.${kind === "video" ? "mp4" : "jpg"}`;
}
export function mediaPosterPath(prefix: string, index: number): string {
  return `${prefix}/${index}.poster.jpg`;
}
export function stagedVideoPath(userId: string, messageId: string, index: number): string {
  return `${uuid(userId, "user id")}/${uuid(messageId, "message id")}-${index}.orig`;
}
export function isDemoMediaPath(path: string): boolean {
  return path.startsWith(DEMO_MEDIA_PREFIX);
}

// ---------------------------------------------------------------------------
// The row's media array
// ---------------------------------------------------------------------------

export interface ChatMediaItem {
  kind: ChatMediaKind;
  /** Storage path, a demo key, or a pending placeholder; null once a video expired. */
  path: string | null;
  /** Video poster path (null once expired). */
  poster?: string | null;
  width: number;
  height: number;
  /** Videos only. */
  durationMs?: number;
  /** Photos only: the ~16 px placeholder. */
  thumb?: string | null;
  /** A video past the 180-day retention: files deleted, only its size/length remain. */
  expired?: boolean;
}

/** One item exactly as stored (keys the database accepts). */
export type MediaItemJson =
  | { kind: "image"; path: string; w: number; h: number; thumb?: string }
  | { kind: "video"; path: string; poster: string; w: number; h: number; ms: number }
  | { kind: "video"; expired: true; w: number; h: number; ms: number };

const posInt = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null;

/** The media a fetched row carries (anything malformed is dropped), or null. */
export function mediaFromRow(media: unknown): ChatMediaItem[] | null {
  if (!Array.isArray(media) || media.length === 0) return null;
  const items: ChatMediaItem[] = [];
  for (const raw of media.slice(0, MEDIA_MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const w = posInt(r.w, 4096), h = posInt(r.h, 4096);
    if (!w || !h) continue;
    if (r.kind === "image" && typeof r.path === "string") {
      items.push({ kind: "image", path: r.path, width: w, height: h, thumb: typeof r.thumb === "string" ? r.thumb : null });
    } else if (r.kind === "video") {
      const ms = posInt(r.ms, VIDEO_DB_MAX_MS) ?? 1;
      if (r.expired === true) items.push({ kind: "video", path: null, poster: null, width: w, height: h, durationMs: ms, expired: true });
      else if (typeof r.path === "string") items.push({ kind: "video", path: r.path, poster: typeof r.poster === "string" ? r.poster : null, width: w, height: h, durationMs: ms });
    }
  }
  return items.length ? items : null;
}

/** The value to insert for these items under `prefix` (paths derived from the position, as the database requires). */
export function mediaRowValue(prefix: string, items: readonly { kind: ChatMediaKind; width: number; height: number; durationMs?: number; thumb?: string | null }[]): MediaItemJson[] {
  return items.map((it, i) => {
    const w = Math.max(1, Math.min(4096, Math.round(it.width)));
    const h = Math.max(1, Math.min(4096, Math.round(it.height)));
    if (it.kind === "video") {
      return { kind: "video", path: mediaItemPath(prefix, i, "video"), poster: mediaPosterPath(prefix, i), w, h, ms: clampVideoMs(it.durationMs ?? 1) };
    }
    const item: MediaItemJson = { kind: "image", path: mediaItemPath(prefix, i, "image"), w, h };
    if (it.thumb && it.thumb.length <= 2048 && THUMB_RE.test(it.thumb)) item.thumb = it.thumb;
    return item;
  });
}

export function clampVideoMs(ms: number): number {
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.min(VIDEO_DB_MAX_MS, Math.round(ms)));
}

/**
 * The database's own rule (private.chat_media_valid), mirrored for tests
 * and as a last check before an insert.
 */
export function isValidMediaValue(value: unknown, prefix: string): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > MEDIA_MAX_ITEMS) return false;
  return value.every((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const r = raw as Record<string, unknown>;
    const keys = Object.keys(r);
    if (!posInt(r.w, 4096) || !posInt(r.h, 4096)) return false;
    if (r.kind === "image") {
      if (!keys.every((k) => ["kind", "path", "w", "h", "thumb"].includes(k))) return false;
      if (r.path !== `${prefix}/${i}.jpg`) return false;
      return r.thumb === undefined || r.thumb === null || (typeof r.thumb === "string" && r.thumb.length <= 2048 && THUMB_RE.test(r.thumb));
    }
    if (r.kind === "video") {
      if (!keys.every((k) => ["kind", "path", "poster", "w", "h", "ms", "expired"].includes(k))) return false;
      if (!posInt(r.ms, VIDEO_DB_MAX_MS)) return false;
      if ("expired" in r) return r.expired === true && !("path" in r) && !("poster" in r);
      return r.path === `${prefix}/${i}.mp4` && r.poster === `${prefix}/${i}.poster.jpg`;
    }
    return false;
  });
}

/** Every stored object the items name (paths and posters): what unsend / discard deletes. */
export function mediaObjectNames(items: readonly Pick<ChatMediaItem, "path" | "poster">[] | null | undefined): string[] {
  const out: string[] = [];
  for (const it of items ?? []) {
    if (it.path) out.push(it.path);
    if (it.poster) out.push(it.poster);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feature detection (the client ships before the migration)
// ---------------------------------------------------------------------------

export function rowsHaveMediaColumn(rows: readonly object[]): boolean {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, "media"));
}

/** messages.media isn't there yet (insert PGRST204 / select 42703 naming it). */
export function isMissingMediaSupportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const msg = typeof message === "string" ? message : "";
  if ((code === "PGRST204" || code === "42703") && (msg === "" || /\bmedia\b/.test(msg))) return true;
  return /\bmedia\b/.test(msg) && /column/i.test(msg);
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

export function mediaCounts(items: readonly Pick<ChatMediaItem, "kind">[]): { photos: number; videos: number } {
  let photos = 0, videos = 0;
  for (const it of items) {
    if (it.kind === "video") videos += 1;
    else photos += 1;
  }
  return { photos, videos };
}

/**
 * The bracketed label: "[Video]" for a single video, else "[3 photos]",
 * "[2 videos]", "[2 photos, 1 video]". `t` supplies the localized pieces.
 */
export function mediaLabel(
  items: readonly Pick<ChatMediaItem, "kind">[],
  t: {
    video: string;
    photos: (n: number) => string;
    videos: (n: number) => string;
    mixed: (photos: string, videos: string) => string;
    list: (inner: string) => string;
  },
): string {
  const { photos, videos } = mediaCounts(items);
  if (videos === 1 && photos === 0) return t.video;
  if (photos > 0 && videos > 0) return t.list(t.mixed(t.photos(photos), t.videos(videos)));
  return t.list(photos > 0 ? t.photos(photos) : t.videos(videos));
}

// ---------------------------------------------------------------------------
// Composer: the picked items (up to 10, photos and videos mixed)
// ---------------------------------------------------------------------------

/** A picked video, read on the device (never re-encoded here: the server does that). */
export interface PreparedChatVideo {
  file: File;
  /** Object URL of the original (the chip / this device's sending bubble plays it). */
  localUrl: string;
  /** A frame from it, when the browser could decode it. */
  posterUrl: string | null;
  /** The original's size (0 = unknown: this browser can't decode it, e.g. HEVC on a desktop). */
  width: number;
  height: number;
  /** The original's full length (0 = unknown). */
  sourceDurationMs: number;
  /** The part to send; null = the whole clip (at most the first 60 s, server-side). */
  trim: { startMs: number; endMs: number } | null;
}

// `generation`: the conversation visit the item was picked in (the same
// visit model as lib/chatImageAttachment.ts: the hook bumps it whenever the
// thread / round changes, so A -> B -> A is three visits). A visit only
// ever sees, sends or keeps its own items.
export type MediaAttachmentItem = { generation?: number } & (
  | { key: string; kind: "image"; state: "processing" }
  | { key: string; kind: "image"; state: "ready"; image: ProcessedChatImage }
  | { key: string; kind: "video"; state: "processing" }
  | { key: string; kind: "video"; state: "trimming"; video: PreparedChatVideo }
  | { key: string; kind: "video"; state: "ready"; video: PreparedChatVideo }
);

export type MediaAttachmentEvent =
  | { type: "add"; items: { key: string; kind: ChatMediaKind }[]; limit: number; generation?: number }
  | { type: "leave"; generation: number }
  | { type: "imageReady"; key: string; image: ProcessedChatImage }
  | { type: "videoRead"; key: string; video: PreparedChatVideo }
  | { type: "trimmed"; key: string; trim: { startMs: number; endMs: number } }
  | { type: "failed"; key: string }
  | { type: "remove"; key: string }
  | { type: "clear" };

/** What a send of these items needs: ready ones only, in order. */
export function videoDurationToSend(video: PreparedChatVideo): number {
  if (video.trim) return Math.min(VIDEO_MAX_MS, video.trim.endMs - video.trim.startMs);
  return video.sourceDurationMs > 0 ? Math.min(VIDEO_MAX_MS, video.sourceDurationMs) : VIDEO_MAX_MS;
}

/** A video that is longer than 60 s and has no window yet must be trimmed first. */
export function needsTrim(video: Pick<PreparedChatVideo, "sourceDurationMs" | "trim">): boolean {
  return !video.trim && video.sourceDurationMs > VIDEO_MAX_MS + 250;
}

/**
 * The picked items, in pick order. New picks are appended up to `limit`
 * (anything past it is dropped; the page says so). An item's result for a
 * key that is gone (removed meanwhile) is ignored. Returns the same array
 * when nothing changes.
 */
export function mediaAttachmentReducer(state: readonly MediaAttachmentItem[], event: MediaAttachmentEvent): readonly MediaAttachmentItem[] {
  switch (event.type) {
    case "add": {
      // Items of another visit never stay next to this visit's (see "leave").
      const own = state.filter((it) => it.generation === event.generation);
      const room = Math.max(0, event.limit - own.length);
      if (room === 0 || event.items.length === 0) return own.length === state.length ? state : own;
      return [...own, ...event.items.slice(0, room).map((i) => ({ key: i.key, kind: i.kind, state: "processing", generation: event.generation }) as MediaAttachmentItem)];
    }
    case "leave": {
      const next = state.filter((it) => it.generation === event.generation);
      return next.length === state.length ? state : next;
    }
    case "imageReady":
      return replace(state, event.key, (it) =>
        it.kind === "image" && it.state === "processing" ? { key: it.key, kind: "image", state: "ready", image: event.image, generation: it.generation } : it,
      );
    case "videoRead":
      return replace(state, event.key, (it) =>
        it.kind === "video" && it.state === "processing"
          ? { key: it.key, kind: "video", state: needsTrim(event.video) ? "trimming" : "ready", video: event.video, generation: it.generation }
          : it,
      );
    case "trimmed":
      return replace(state, event.key, (it) =>
        it.kind === "video" && it.state === "trimming" ? { key: it.key, kind: "video", state: "ready", video: { ...it.video, trim: event.trim }, generation: it.generation } : it,
      );
    case "failed":
    case "remove": {
      const next = state.filter((it) => it.key !== event.key);
      return next.length === state.length ? state : next;
    }
    case "clear":
      return state.length === 0 ? state : [];
  }
}

function replace(state: readonly MediaAttachmentItem[], key: string, fn: (it: MediaAttachmentItem) => MediaAttachmentItem): readonly MediaAttachmentItem[] {
  let changed = false;
  const next = state.map((it) => {
    if (it.key !== key) return it;
    const r = fn(it);
    if (r !== it) changed = true;
    return r;
  });
  return changed ? next : state;
}

/** What a visit may show / send: its own items only. */
export function visitItems(state: readonly MediaAttachmentItem[], generation: number): readonly MediaAttachmentItem[] {
  return state.every((it) => it.generation === generation) ? state : state.filter((it) => it.generation === generation);
}

/** Send is possible: at least one item and every item ready (none processing / waiting for a trim). */
export function mediaReady(state: readonly MediaAttachmentItem[]): boolean {
  return state.length > 0 && state.every((it) => it.state === "ready");
}

/** The one-send-per-draft guard's key for the picked items. */
export function mediaSendKey(state: readonly MediaAttachmentItem[]): string | null {
  return state.length ? `media:${state.map((it) => it.key).join(",")}` : null;
}

/**
 * How the picked items are sent: exactly one photo keeps the original
 * single-photo path (image_path, unchanged), anything else is a media
 * message. Before the media migration only a single photo is possible.
 */
export function sendShape(state: readonly MediaAttachmentItem[]): "photo" | "media" | "none" {
  if (state.length === 0) return "none";
  if (state.length === 1 && state[0].kind === "image") return "photo";
  return "media";
}

// ---------------------------------------------------------------------------
// Sending: per-item state (upload / transcode), so a retry resumes
// ---------------------------------------------------------------------------

export interface MediaSendItem {
  kind: ChatMediaKind;
  /** Photo: the re-encoded JPEG. Video: the original file. */
  blob: Blob;
  localUrl: string;
  posterUrl: string | null;
  width: number;
  height: number;
  durationMs: number;
  thumb: string | null;
  trim: { startMs: number; endMs: number } | null;
  /** 0..1: upload progress (videos: the original's upload, then processing). */
  progress: number;
  /** Video: the original is in chat-video-incoming. */
  staged?: boolean;
  /** Video: resumable upload URL (TUS) of an unfinished staged upload. */
  uploadUrl?: string;
  /** The item is stored in chat-video (photo uploaded / video transcoded). */
  done: boolean;
  /** Video: the transcoder's answer (the stored size and length win over the original's). */
  result?: { width: number; height: number; durationMs: number };
}

/** A ready composer item, as the page hands it to a send. */
export type ChatMediaDraftItem = { kind: "image"; image: ProcessedChatImage } | { kind: "video"; video: PreparedChatVideo };

/** The ready items of the composer, in order (anything not ready is skipped). */
export function readyDraftItems(state: readonly MediaAttachmentItem[]): ChatMediaDraftItem[] {
  const out: ChatMediaDraftItem[] = [];
  for (const it of state) {
    if (it.state !== "ready") continue;
    if (it.kind === "image") out.push({ kind: "image", image: it.image });
    else out.push({ kind: "video", video: it.video });
  }
  return out;
}

/** Draft items -> the per-item send state (unknown video size: 16:9 until the transcoder answers). */
export function toMediaSendItems(items: readonly ChatMediaDraftItem[]): MediaSendItem[] {
  return items.slice(0, MEDIA_MAX_ITEMS).map((it) =>
    it.kind === "image"
      ? { kind: "image", blob: it.image.blob, localUrl: it.image.previewUrl, posterUrl: null, width: it.image.width, height: it.image.height, durationMs: 0, thumb: it.image.thumb, trim: null, progress: 0, done: false }
      : {
          kind: "video",
          blob: it.video.file,
          localUrl: it.video.localUrl,
          posterUrl: it.video.posterUrl,
          width: it.video.width || 1280,
          height: it.video.height || 720,
          durationMs: videoDurationToSend(it.video),
          thumb: null,
          trim: it.video.trim,
          progress: 0,
          done: false,
        },
  );
}

/** Photo or video, from the File the picker handed over (type first, then the name; iOS sometimes sends no type). */
export function mediaKindOfFile(file: { type: string; name: string }): ChatMediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (/\.(mov|mp4|m4v|webm|3gp|avi|mkv)$/i.test(file.name)) return "video";
  if (/\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name)) return "image";
  return file.type === "" ? "image" : null;
}

/** A media fragment that plays only the trimmed window of a local original (this device's sending bubble, demo). */
export function localWindowUrl(url: string, trim: { startMs: number; endMs: number } | null | undefined): string {
  if (!trim || url.includes("#")) return url;
  return `${url}#t=${(trim.startMs / 1000).toFixed(2)},${(trim.endMs / 1000).toFixed(2)}`;
}

/** Overall progress (0..1) of an album send: each item weighs the same. */
export function albumProgress(items: readonly Pick<MediaSendItem, "progress" | "done">[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, it) => sum + (it.done ? 1 : Math.max(0, Math.min(1, it.progress))), 0) / items.length;
}

/** The transcoder's answer -> what to do. */
export function classifyVideoProcess(status: number, error: string | undefined): "ok" | ImageSendFailure {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "rejected";
  // The file itself can't be sent (not a video, can't be decoded, too big):
  // a retry won't help.
  if (status === 413 || status === 422 || status === 400) return "rejected";
  if (status === 404 && error === "staged_missing") return "network"; // re-upload on retry
  return "network";
}

/** The row columns for the items once every one is stored (the transcoder's sizes for videos). */
export function sentMediaItems(items: readonly MediaSendItem[]): { kind: ChatMediaKind; width: number; height: number; durationMs?: number; thumb?: string | null }[] {
  return items.map((it) =>
    it.kind === "video"
      ? { kind: "video", width: it.result?.width ?? it.width, height: it.result?.height ?? it.height, durationMs: it.result?.durationMs ?? it.durationMs }
      : { kind: "image", width: it.width, height: it.height, thumb: it.thumb },
  );
}

// ---------------------------------------------------------------------------
// Bubble geometry and the deck
// ---------------------------------------------------------------------------

/** "0:07", "1:00". */
export function formatVideoDuration(ms: number): string {
  const s = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A single video's box (CSS px), from the stored size, so nothing moves while it loads. */
export function videoDisplaySize(width: number, height: number, maxWidth = 240, maxHeight = 320, minEdge = 120): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: maxWidth, height: Math.round((maxWidth * 9) / 16) };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minEdge, width * scale))),
    height: Math.round(Math.min(maxHeight, Math.max(minEdge, height * scale))),
  };
}

/** The deck's cards all share one box (from the first item's shape, capped), plus room for the fan. */
export const DECK_FAN_PX = 14;
export function deckDisplaySize(items: readonly Pick<ChatMediaItem, "width" | "height">[]): { width: number; height: number } {
  const first = items[0];
  const card = first ? videoDisplaySize(first.width, first.height, 210, 260, 150) : { width: 210, height: 210 };
  return { width: card.width + DECK_FAN_PX * 2, height: card.height + DECK_FAN_PX };
}

/**
 * Where each card sits for the card at `current` on top: the top card flat,
 * the next two peeking behind it, fanned alternately left / right and a
 * little lower and smaller; cards already swiped past and later ones hide
 * behind. `dx` is the live drag of the top card. Reduced motion: no fan
 * (cards stack flat; only the top one shows).
 */
export function deckCardStyle(index: number, current: number, count: number, dx: number, reducedMotion: boolean): { x: number; y: number; rotate: number; scale: number; z: number; opacity: number } {
  const depth = index - current;
  if (depth === 0) return { x: dx, y: 0, rotate: reducedMotion ? 0 : dx / 24, scale: 1, z: count + 1, opacity: 1 };
  if (depth < 0 || depth > 2 || reducedMotion) return { x: 0, y: 0, rotate: 0, scale: 0.94, z: 0, opacity: 0 };
  const side = depth % 2 === 1 ? -1 : 1;
  return { x: side * DECK_FAN_PX * 0.6 * depth, y: DECK_FAN_PX * 0.45 * depth, rotate: side * 4 * depth, scale: 1 - 0.04 * depth, z: count - depth, opacity: 1 };
}

/** Swipe-to-flip threshold (px) and velocity (px/ms). */
export const DECK_FLIP_PX = 48;
export const DECK_FLIP_VELOCITY = 0.45;

/** The card after a horizontal swipe on the deck: left = next, right = previous; clamped (no wrap). */
export function deckIndexAfterSwipe(current: number, count: number, dx: number, velocity = 0): number {
  const fast = Math.abs(velocity) >= DECK_FLIP_VELOCITY && Math.abs(dx) >= 12;
  if (Math.abs(dx) < DECK_FLIP_PX && !fast) return current;
  const next = dx < 0 ? current + 1 : current - 1;
  return Math.max(0, Math.min(count - 1, next));
}

/**
 * Who owns a drag that started ON the deck: the deck flips cards on a
 * mostly-horizontal move; a mostly-vertical one is the list's scroll.
 * Swipe-to-reply and swipe-left-for-times never start on the deck
 * ([data-chat-deck] is skipped by both); a deck message is replied to from
 * the hold menu.
 */
export function deckAxis(dx: number, dy: number, slop = 8): "pending" | "deck" | "scroll" {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "deck" : "scroll";
}
