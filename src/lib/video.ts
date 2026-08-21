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

/** The actual displayed content rectangle within a <video> element's own
 * box, in CSS pixels relative to that box's top-left — i.e. undoing the
 * letterboxing a video with an aspect ratio different from its container
 * produces by default (browsers keep the real video content
 * aspect-ratio-correct and centered, not stretched, exactly like
 * object-fit: contain, even with no CSS object-fit set at all). Needed to
 * position a keypoint overlay canvas over the real video pixels, not the
 * element's full (possibly letterboxed) box. */
export function getVideoContentRect(video: HTMLVideoElement): { left: number; top: number; width: number; height: number } {
  const boxWidth = video.clientWidth;
  const boxHeight = video.clientHeight;
  const videoRatio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : boxWidth / boxHeight;
  const boxRatio = boxWidth / boxHeight;
  if (!videoRatio || !boxRatio || boxWidth === 0 || boxHeight === 0) {
    return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  }
  if (videoRatio > boxRatio) {
    // Video is relatively wider than its box — full width, letterboxed top/bottom.
    const height = boxWidth / videoRatio;
    return { left: 0, top: (boxHeight - height) / 2, width: boxWidth, height };
  }
  // Video is relatively taller than its box — full height, pillarboxed left/right.
  const width = boxHeight * videoRatio;
  return { left: (boxWidth - width) / 2, top: 0, width, height: boxHeight };
}
