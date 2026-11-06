// Voice messages in chat (DMs and round group chats), WeChat-style: a
// "Hold to talk" bar, release to send, slide up to cancel, 60 s max. The
// rules that don't need a browser: paths, the recording format, the
// hold / slide-cancel / max-length state machine, rows and previews. No
// React / DOM / Supabase imports, so tests/chatVoice.test.ts runs it under
// plain node.
//
// Storage (migration 20261107180000_chat_voice): the same PRIVATE chat-media
// bucket and rules as photos (lib/chatImages.ts), one file per message:
//   dm/<conversation_id>/<message_id>.m4a | .webm
//   round/<round_id>/<message_id>.m4a | .webm
// Recordings never leave the chat: no transcription, no server processing.
//
// Format: AAC in MP4 (.m4a) wherever MediaRecorder can make it (iPhone
// Safari / WKWebView, Safari on Mac, Chrome/Edge builds with AAC), because
// every iPhone plays it. Otherwise (Firefox, Chromium without AAC) WebM/Opus:
// iOS 17.4+ / Safari 18 play WebM Opus, older iPhones may not, and the
// bubble then says it can't play here. No client-side transcoding: it would
// mean shipping an ~25 MB WebAssembly encoder for a minority of senders.

export const VOICE_MAX_MS = 60_000;
/** Shorter than this is a tap, not a message (WeChat: "Too short"). */
export const VOICE_MIN_MS = 700;
/** Slide this far up from where the hold started = cancel on release. */
export const VOICE_CANCEL_DY = 72;
/** Database limit on the stored duration (a little over the max for timer slop). */
export const VOICE_DB_MAX_MS = 61_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const VOICE_PATH_RE = new RegExp(`^(dm|round)/(${UUID})/(${UUID})\\.(m4a|webm)$`);

export type VoiceExt = "m4a" | "webm";

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/** In order of preference (see the header). */
export const VOICE_MIME_CANDIDATES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

/** The MediaRecorder mimeType to ask for, or null when nothing usable is supported. */
export function pickVoiceMime(isTypeSupported: ((type: string) => boolean) | null | undefined): string | null {
  if (!isTypeSupported) return null;
  for (const type of VOICE_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // A browser that throws for a type just doesn't support it.
    }
  }
  return null;
}

/** File extension + the Content-Type stored (no codec parameters: the bucket allows exactly these). */
export function voiceFileType(recordedMime: string): { ext: VoiceExt; contentType: "audio/mp4" | "audio/webm" } {
  return /webm/i.test(recordedMime) ? { ext: "webm", contentType: "audio/webm" } : { ext: "m4a", contentType: "audio/mp4" };
}

/** The Content-Type for a stored path. */
export function voiceContentTypeForPath(path: string): "audio/mp4" | "audio/webm" {
  return path.endsWith(".webm") ? "audio/webm" : "audio/mp4";
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function uuid(value: string, what: string): string {
  const v = value.toLowerCase();
  if (!UUID_RE.test(v)) throw new Error(`voice path: ${what} is not a uuid`);
  return v;
}

export function dmVoicePath(conversationId: string, messageId: string, ext: VoiceExt): string {
  return `dm/${uuid(conversationId, "conversation id")}/${uuid(messageId, "message id")}.${ext}`;
}

export function roundVoicePath(roundId: string, messageId: string, ext: VoiceExt): string {
  return `round/${uuid(roundId, "round id")}/${uuid(messageId, "message id")}.${ext}`;
}

export function parseVoicePath(path: string): { scope: "dm" | "round"; scopeId: string; messageId: string; ext: VoiceExt } | null {
  const m = VOICE_PATH_RE.exec(path);
  return m ? { scope: m[1] as "dm" | "round", scopeId: m[2], messageId: m[3], ext: m[4] as VoiceExt } : null;
}

/** Demo account recordings live only in this page's memory, under this prefix. */
export const DEMO_VOICE_PREFIX = "demo-voice/";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface ChatVoiceRef {
  path: string;
  durationMs: number;
}

export interface VoiceRowColumns {
  audio_path?: string | null;
  audio_duration_ms?: number | null;
}

export function voiceFromRow(row: VoiceRowColumns): ChatVoiceRef | null {
  if (!row.audio_path || !row.audio_duration_ms) return null;
  return { path: row.audio_path, durationMs: row.audio_duration_ms };
}

export function voiceRowColumns(voice: ChatVoiceRef): Required<VoiceRowColumns> {
  return { audio_path: voice.path, audio_duration_ms: clampDuration(voice.durationMs) };
}

/** 1 ms .. VOICE_DB_MAX_MS, whole ms (the database's range). */
export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.min(VOICE_DB_MAX_MS, Math.round(ms)));
}

/** A fetched row (select "*") carries audio_path: the voice migration is applied. */
export function rowsHaveVoiceColumn(rows: readonly object[]): boolean {
  return rows.some((r) => Object.prototype.hasOwnProperty.call(r, "audio_path"));
}

/** The voice columns aren't there yet (insert PGRST204 / select 42703 naming them). */
export function isMissingVoiceSupportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const msg = typeof message === "string" ? message : "";
  if ((code === "PGRST204" || code === "42703") && (msg === "" || /audio_(path|duration_ms)/.test(msg))) return true;
  return /audio_path/.test(msg) && /column/i.test(msg);
}

/** "0:07", "1:00" (rounded up to the next second while > 0, like a voice memo). */
export function formatVoiceDuration(ms: number): string {
  const s = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Bubble width (px) grows with the length, like WeChat: 1 s short, 60 s full. */
export function voiceBubbleWidth(ms: number, min = 120, max = 232): number {
  const f = Math.max(0, Math.min(1, ms / VOICE_MAX_MS));
  return Math.round(min + (max - min) * Math.sqrt(f));
}

// ---------------------------------------------------------------------------
// Hold to talk
// ---------------------------------------------------------------------------

// idle        the bar says "Hold to talk"
// starting    finger down, waiting for the microphone (first time: the
//             permission prompt). A release now cancels quietly.
// recording   recording since `startedAt`; `cancelArmed` while the finger is
//             slid up past VOICE_CANCEL_DY ("Release to cancel")
// The result of each event says what the page must do (`effect`).
export type VoiceState =
  | { kind: "idle" }
  | { kind: "starting"; downY: number }
  | { kind: "recording"; downY: number; startedAt: number; cancelArmed: boolean };

export type VoiceEvent =
  | { type: "press"; y: number }
  | { type: "started"; at: number }
  | { type: "failed" }
  | { type: "move"; y: number }
  | { type: "release"; at: number }
  | { type: "tick"; at: number }
  | { type: "interrupt" };

// start    ask for the microphone and start recording
// stop     stop and SEND what was recorded (durationMs)
// discard  stop and throw the recording away (reason)
// abort    give up on a start still in progress (no recorder yet / release
//          before it started): its microphone is released when it arrives
//          and it can never become the recording (lib/voiceSession.ts)
export type VoiceEffect =
  | { type: "none" }
  | { type: "start" }
  | { type: "stop"; durationMs: number }
  | { type: "discard"; reason: "cancelled" | "tooShort" | "interrupted" }
  | { type: "abort" };

const NONE: VoiceEffect = { type: "none" };

export function voiceStep(state: VoiceState, event: VoiceEvent): { state: VoiceState; effect: VoiceEffect } {
  switch (event.type) {
    case "press":
      if (state.kind !== "idle") return { state, effect: NONE };
      return { state: { kind: "starting", downY: event.y }, effect: { type: "start" } };
    case "started":
      if (state.kind !== "starting") return { state, effect: NONE };
      return { state: { kind: "recording", downY: state.downY, startedAt: event.at, cancelArmed: false }, effect: NONE };
    case "failed":
      // Only a start still waiting can fail; a recording (or idle) is never
      // reset by a failure report (lib/voiceSession.ts owns which attempt).
      if (state.kind !== "starting") return { state, effect: NONE };
      return { state: { kind: "idle" }, effect: NONE };
    case "move": {
      if (state.kind !== "recording") return { state, effect: NONE };
      const armed = state.downY - event.y >= VOICE_CANCEL_DY;
      return armed === state.cancelArmed ? { state, effect: NONE } : { state: { ...state, cancelArmed: armed }, effect: NONE };
    }
    case "release": {
      if (state.kind === "starting") return { state: { kind: "idle" }, effect: { type: "abort" } };
      if (state.kind !== "recording") return { state, effect: NONE };
      const durationMs = Math.min(VOICE_MAX_MS, event.at - state.startedAt);
      if (state.cancelArmed) return { state: { kind: "idle" }, effect: { type: "discard", reason: "cancelled" } };
      if (durationMs < VOICE_MIN_MS) return { state: { kind: "idle" }, effect: { type: "discard", reason: "tooShort" } };
      return { state: { kind: "idle" }, effect: { type: "stop", durationMs } };
    }
    case "tick": {
      if (state.kind !== "recording") return { state, effect: NONE };
      if (event.at - state.startedAt < VOICE_MAX_MS) return { state, effect: NONE };
      // 60 s: sent as if released (WeChat), unless the finger is on cancel.
      if (state.cancelArmed) return { state: { kind: "idle" }, effect: { type: "discard", reason: "cancelled" } };
      return { state: { kind: "idle" }, effect: { type: "stop", durationMs: VOICE_MAX_MS } };
    }
    case "interrupt":
      // pointercancel, the app going to the background, a call: never sends.
      if (state.kind === "starting") return { state: { kind: "idle" }, effect: { type: "abort" } };
      if (state.kind === "recording") return { state: { kind: "idle" }, effect: { type: "discard", reason: "interrupted" } };
      return { state, effect: NONE };
  }
}

/** Seconds left to show near the end (WeChat counts down the last 10). */
export function voiceSecondsLeft(elapsedMs: number): number | null {
  const left = Math.ceil((VOICE_MAX_MS - elapsedMs) / 1000);
  return left <= 10 ? Math.max(0, left) : null;
}

/** Whether this browser could record at all (feature detection for the mic button). */
export function canRecordVoice(env: { getUserMedia: boolean; mediaRecorder: boolean; isTypeSupported: ((t: string) => boolean) | null }): boolean {
  return env.getUserMedia && env.mediaRecorder && pickVoiceMime(env.isTypeSupported) !== null;
}
