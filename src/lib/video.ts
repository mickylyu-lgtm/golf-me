// Safari/iOS's native fullscreen video player — the one with ±10s skip
// buttons, PiP/AirPlay, and a time-remaining scrubber — isn't reachable via
// the standard Fullscreen API on iPhone; it needs the WebKit-specific
// `webkitEnterFullscreen()` call on the <video> element itself. Standard
// `requestFullscreen()` is tried first for browsers where that's the real
// native player (desktop Chrome/Firefox, Android); iOS Safari doesn't
// implement `requestFullscreen` on <video> at all, so the WebKit fallback
// is what actually fires there.
export function enterNativeVideoFullscreen(video: HTMLVideoElement): void {
  const webkitVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  if (typeof webkitVideo.webkitEnterFullscreen === "function") {
    webkitVideo.webkitEnterFullscreen();
  } else if (video.requestFullscreen) {
    video.requestFullscreen().catch(() => {});
  }
}
