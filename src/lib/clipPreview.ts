// The picked-clip preview on Analyze a Swing (components/caddie/
// SelectedClipPreview.tsx): plays only the section Caddie will analyze,
// inline, and never opens the system's fullscreen player on its own.
//
// Root cause of "Use This Clip opens the whole original video in fullscreen"
// (Micky, 2026-11-09): the old preview was a `<video controls>` WITHOUT
// `playsinline`, and an effect called play() on it the moment it mounted (to
// get a first frame painted). Capacitor's WKWebView sets
// allowsInlineMediaPlayback = true and lets play() run without a gesture,
// which makes WebKit play a video that lacks `playsinline` in its native
// fullscreen player. Both "Use This Clip" and a short clip from the picker
// mount that preview, so both jumped to fullscreen. The trim screen's own
// preview never did: it is `muted playsInline`.

export interface ClipRange {
  start: number;
  end: number;
  /** True when the golfer picked a section of a longer video. */
  trimmed: boolean;
}

/** The section that plays and that Caddie analyzes; null until the length is known for an untrimmed clip. */
export function clipPreviewRange(trimStart: number | undefined, trimEnd: number | undefined, duration: number | undefined): ClipRange | null {
  if (trimStart !== undefined && trimEnd !== undefined && trimEnd > trimStart) {
    return { start: Math.max(0, trimStart), end: trimEnd, trimmed: true };
  }
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) return { start: 0, end: duration, trimmed: false };
  return null;
}

/** Whole seconds shown in the summary (a 9.96 s window reads as 10 s). */
export function clipSeconds(range: ClipRange): number {
  return Math.max(1, Math.round(range.end - range.start));
}

// timeupdate can arrive up to ~250 ms late; stopping this close to the end
// counts as the end so the next play starts from the section's start.
const END_TOLERANCE_S = 0.05;

/**
 * What the preview does at `time`: keep playing, or stop at the section's
 * end and go back to its start. A time before the start (a seek, a first
 * frame at 0) jumps to the start.
 */
export function clipPlaybackStep(time: number, range: ClipRange): { action: "continue" } | { action: "seek"; to: number } | { action: "stop"; to: number } {
  if (time >= range.end - END_TOLERANCE_S) return { action: "stop", to: range.start };
  if (time < range.start - END_TOLERANCE_S) return { action: "seek", to: range.start };
  return { action: "continue" };
}

/** Where a play press starts: from the section's start when at (or past) its end. */
export function clipPlayFrom(time: number, range: ClipRange): number {
  return time < range.start - END_TOLERANCE_S || time >= range.end - END_TOLERANCE_S ? range.start : time;
}

/**
 * Makes a <video> safe to play() without a fullscreen takeover on iOS:
 * the `playsinline` attribute must be on the element BEFORE play() runs.
 */
export function ensureInlinePlayback(video: HTMLVideoElement): void {
  video.playsInline = true;
  if (!video.hasAttribute("playsinline")) video.setAttribute("playsinline", "");
}
