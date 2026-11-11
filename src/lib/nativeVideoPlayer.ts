import { enterNativeVideoFullscreen, isVideoInNativeFullscreen } from "./video.ts";

// Shared platform player for Community and Chat. The opening tap enables
// native controls and sound, then restores the silent inline preview on exit.
// Keep the request synchronous: iPhone WebKit requires the user gesture.
export const NATIVE_GRACE_MS = 1000;

export interface NativeVideoOptions {
  /** Start here (seconds). Default 0; Community supplies its current feed position. */
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
export function openVideoNatively(video: HTMLVideoElement, options: NativeVideoOptions): NativeVideoSession | null {
  if (active && active.video !== video) active.cancel();
  else if (active) return active; // a second tap on the same video while it opens
  const v = video as WebKitVideo;
  const saved = { loop: v.loop, controls: v.controls };
  v.setAttribute("data-native-video-player", "");
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
    v.controls = saved.controls;
    v.removeAttribute("data-native-video-player");
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
      finish(false); // remove listeners before a synchronous WebKit exit event
      exitFullscreen(v);
      v.pause();
    },
  };

  for (const [type, fn] of listeners) v.addEventListener(type, fn);
  // The standard fullscreenchange bubbles to the document (and fires only there in some engines).
  document.addEventListener("fullscreenchange", onFsChange);
  active = session;
  silenceOthers(v);

  v.controls = true;
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
