import { enterNativeVideoFullscreen, isVideoInNativeFullscreen } from "./video.ts";

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

/** WebKit sometimes accepts webkitEnterFullscreen() but never shows the player: after this long, fall back. */
export const NATIVE_GRACE_MS = 1000;
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

export interface NativeVideoOptions {
  /** Start here (seconds). Default 0: a chat video opens from its beginning. */
  startAt?: number;
  /** Stop here (seconds): a sender's local original played with its trim window. */
  endAt?: number;
  /** The native player was refused or never appeared: open the in-app viewer instead. */
  onRefused: () => void;
  /** The native player closed (and PiP, if any, ended). The element is muted again. */
  onEnd: () => void;
}

export interface NativeVideoSession {
  video: HTMLVideoElement;
  /** Ends quietly (unmount, a newer session, a load error): exits fullscreen, pauses, mutes; no callbacks. */
  cancel: () => void;
}

type WebKitVideo = HTMLVideoElement & {
  webkitExitFullscreen?: () => void;
  webkitPresentationMode?: string;
};

let active: NativeVideoSession | null = null;

/** The session playing now, if any. */
export function activeNativeVideo(): HTMLVideoElement | null {
  return active?.video ?? null;
}

function silenceOthers(except: HTMLVideoElement) {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((el) => {
    if (el === except || el.paused) return;
    // Muted inline previews may keep looping (no sound); anything audible stops.
    if (el instanceof HTMLAudioElement || !el.muted) el.pause();
  });
}

function exitFullscreen(video: WebKitVideo) {
  try {
    if (video.webkitPresentationMode === "picture-in-picture" || isVideoInNativeFullscreen(video)) {
      if (typeof video.webkitExitFullscreen === "function") video.webkitExitFullscreen();
      else if (document.fullscreenElement === video) void document.exitFullscreen().catch(() => {});
    }
  } catch {
    // already closed
  }
}

// Rotation inside the player rotates the chat behind it too; when the list
// came back a different width, put this bubble back where it was on screen.
// Height-only changes (the keyboard) are left to the thread's own logic.
function scrollAnchor(video: HTMLElement): (() => void) | null {
  let el: HTMLElement | null = video.parentElement;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return null;
  const scroller = el;
  const width = scroller.clientWidth;
  const offset = video.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return () => {
    if (!video.isConnected || scroller.clientWidth === width) return;
    const now = video.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += now - offset;
  };
}

/**
 * Opens `video` in the native player from inside a tap (the call must stay
 * synchronous in the user's gesture). Returns the session, or null when it
 * was refused right away (onRefused has then been called).
 */
export function openChatVideoNatively(video: HTMLVideoElement, options: NativeVideoOptions): NativeVideoSession | null {
  if (active && active.video !== video) active.cancel();
  else if (active) return active; // a second tap on the same video while it opens
  const v = video as WebKitVideo;
  const saved = { loop: v.loop };
  const restoreAnchor = scrollAnchor(v);
  let started = false;
  let done = false;
  let grace: number | null = null;

  const onTime = () => {
    if (options.endAt !== undefined && v.currentTime >= options.endAt) v.pause();
  };
  const onBegin = () => {
    started = true;
  };
  const onFsChange = () => {
    if (document.fullscreenElement === v) started = true;
    else if (started) onNativeClosed();
  };
  const onPresentation = () => {
    if (v.webkitPresentationMode === "inline" && started && !isVideoInNativeFullscreen(v)) finish(true);
  };
  function onNativeClosed() {
    // Moved into Picture in Picture: keep playing (with sound) until PiP ends.
    if (v.webkitPresentationMode === "picture-in-picture") return;
    finish(true);
  }
  const listeners: [string, EventListener][] = [
    ["webkitbeginfullscreen", onBegin],
    ["webkitendfullscreen", onNativeClosed],
    ["webkitpresentationmodechanged", onPresentation],
    ["timeupdate", onTime],
  ];

  function finish(notify: boolean) {
    if (done) return;
    done = true;
    if (grace !== null) window.clearTimeout(grace);
    for (const [type, fn] of listeners) v.removeEventListener(type, fn);
    document.removeEventListener("fullscreenchange", onFsChange);
    v.muted = true;
    v.loop = saved.loop;
    if (active === session) active = null;
    if (notify) {
      options.onEnd();
      if (restoreAnchor) requestAnimationFrame(() => requestAnimationFrame(restoreAnchor));
    }
  }

  const session: NativeVideoSession = {
    video: v,
    cancel: () => {
      if (done) return;
      exitFullscreen(v);
      v.pause();
      finish(false);
    },
  };

  for (const [type, fn] of listeners) v.addEventListener(type, fn);
  // The standard fullscreenchange bubbles to the document (and fires only there in some engines).
  document.addEventListener("fullscreenchange", onFsChange);
  active = session;
  silenceOthers(v);

  v.loop = false;
  v.muted = false;
  try {
    v.currentTime = options.startAt ?? 0;
  } catch {
    // not seekable yet: plays from where it is
  }
  // Inside the tap, so sound is allowed; if not, it still plays (muted) and
  // the native player's own mute button is there.
  void v.play().catch(() => {
    if (done) return;
    v.muted = true;
    void v.play().catch(() => {});
  });

  if (!enterNativeVideoFullscreen(v)) {
    v.pause();
    finish(false);
    options.onRefused();
    return null;
  }
  if (isVideoInNativeFullscreen(v)) started = true;
  grace = window.setTimeout(() => {
    grace = null;
    if (done || started || isVideoInNativeFullscreen(v)) return;
    v.pause();
    finish(false);
    options.onRefused();
  }, NATIVE_GRACE_MS);
  return session;
}
