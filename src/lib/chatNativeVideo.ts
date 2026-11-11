// Keep the chat API stable while Community uses the same player lifecycle.
export { openVideoNatively as openChatVideoNatively, activeNativeVideo, NATIVE_GRACE_MS } from "./nativeVideoPlayer.ts";
export type { NativeVideoOptions, NativeVideoSession } from "./nativeVideoPlayer.ts";

// Chat videos open in the platform's own player, the same one Community
// videos use (lib/video.ts): on iPhone WebKit's native fullscreen player
// (scrubbable timeline, elapsed / remaining time, play / pause, skip, mute,
// AirPlay and PiP where iOS offers them), elsewhere the Fullscreen API's
// player. The <video> handed over is the bubble's own element, so its link
// is the same per-viewer signed URL the bubble already plays: nothing about
// who may watch it changes.
//
// One session at a time (only the intended video plays): opening a video
// ends the previous session and pauses any other sound in the page (voice
// messages, an unmuted video). When the player closes, the element is muted
// again and its loop restored; the caller decides whether the muted inline
// preview resumes (on screen) or stays paused. A video moved into Picture in
// Picture keeps its session (and sound) until PiP ends.
//
// Pure helpers (link life, renewal timing) are tested in
// tests/chatNativeVideo.test.ts; the element flow headlessly.

/** A signed link with less than this left is not handed to the native player (it could expire mid-watch). */
export const NATIVE_MIN_URL_LIFE_MS = 3 * 60_000;
/** Inline chat videos re-sign their link this long before it expires, so a tap almost always finds a fresh one. */
export const CHAT_VIDEO_RENEW_BEFORE_MS = 10 * 60_000;
/** Never re-sign the same video more often than this (a wrong device clock must not loop). */
export const CHAT_VIDEO_RENEW_MIN_GAP_MS = 5 * 60_000;

/**
 * True when a link expiring at `expiresAt` can be handed to the native
 * player now. Infinity = a local URL (never expires); null = no fresh link
 * known (expired or never signed), so no.
 */
export function linkLongEnough(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt - now >= NATIVE_MIN_URL_LIFE_MS;
}

/**
 * How long to wait before re-signing an inline video's link, or null for
 * never (a local URL, no link known). `lastRenewAt`: when this video last
 * asked for a renewal (0 = never); renewals are spaced at least
 * CHAT_VIDEO_RENEW_MIN_GAP_MS apart.
 */
export function renewDelayMs(expiresAt: number | null, now: number, lastRenewAt = 0): number | null {
  if (expiresAt === null || !Number.isFinite(expiresAt)) return null;
  const due = expiresAt - CHAT_VIDEO_RENEW_BEFORE_MS;
  const earliest = lastRenewAt ? lastRenewAt + CHAT_VIDEO_RENEW_MIN_GAP_MS : 0;
  return Math.max(0, Math.max(due, earliest) - now);
}
