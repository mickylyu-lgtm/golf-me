import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Maximize2, Pause, Play } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { formatClock } from "../../lib/format";
import { clipPlayFrom, clipPlaybackStep, clipPreviewRange, clipSeconds, ensureInlinePlayback } from "../../lib/clipPreview";
import { enterNativeVideoFullscreen, isVideoInNativeFullscreen } from "../../lib/video";

// The picked swing on Analyze a Swing, before Ask Caddie: an inline preview
// of only the section Caddie will analyze, with a plain summary of that
// section. Never opens the system's fullscreen player by itself, only from
// the expand button (lib/clipPreview.ts has the root cause this replaced).
export function SelectedClipPreview({
  previewUrl,
  trimStart,
  trimEnd,
  videoRef,
  action,
}: {
  previewUrl: string;
  trimStart?: number;
  trimEnd?: number;
  /** AnalyzeSwing reads the clip's length from it ("Change section"). */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Shown beside the summary ("Change section"). */
  action?: ReactNode;
}) {
  const { t } = useLocale();
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(trimStart ?? 0);
  const range = clipPreviewRange(trimStart, trimEnd, duration);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // The silent play/pause that gets a first frame painted is not "playing".
  const warmingRef = useRef(false);

  // Paints the section's first frame. Some mobile WebViews show nothing for
  // a paused, never-played <video>, so it is played muted for a moment and
  // paused: safe only because playsinline is set first (without it, iOS
  // plays it in the fullscreen player, the bug this component fixes).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    ensureInlinePlayback(video);
    let cancelled = false;
    async function showFirstFrame() {
      if (!video || cancelled) return;
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      const start = trimStart ?? 0;
      video.currentTime = start;
      setTime(start);
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
      warmingRef.current = true;
      video.muted = true;
      try {
        await video.play();
        if (!cancelled && warmingRef.current) video.pause();
      } catch {
        // Autoplay refused: the poster-less box stays dark until Play.
      } finally {
        if (warmingRef.current) {
          warmingRef.current = false;
          if (!cancelled) video.currentTime = start;
        }
      }
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void showFirstFrame();
    else video.addEventListener("loadedmetadata", showFirstFrame, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", showFirstFrame);
    };
  }, [previewUrl, trimStart, videoRef]);

  // Keeps playback inside the section: stops at its end, back at its start.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const r = rangeRef.current;
      if (!r || video.paused || warmingRef.current) return;
      // The system player (opened from the expand button) is the golfer's own.
      if (!isVideoInNativeFullscreen(video)) {
        const step = clipPlaybackStep(video.currentTime, r);
        if (step.action === "stop") {
          video.pause();
          video.currentTime = step.to;
        } else if (step.action === "seek") video.currentTime = step.to;
      }
      setTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (warmingRef.current) return;
      setPlaying(true);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (warmingRef.current) return;
      setPlaying(false);
      setTime(video.currentTime);
    };
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("durationchange", onMeta);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("durationchange", onMeta);
      // Nothing keeps playing after Remove or a new pick.
      video.pause();
    };
  }, [previewUrl, videoRef]);

  // Standard fullscreen promotes only <video>, not its sibling Play button.
  // Supply browser controls there, but retain the compact custom controls
  // inline. WebKit's native player supplies its own controls independently.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncControls = () => {
      video.controls = document.fullscreenElement === video;
    };
    document.addEventListener("fullscreenchange", syncControls);
    syncControls();
    return () => {
      document.removeEventListener("fullscreenchange", syncControls);
      video.controls = false;
    };
  }, [previewUrl, videoRef]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video || !range) return;
    if (!video.paused && !warmingRef.current) {
      video.pause();
      return;
    }
    warmingRef.current = false;
    ensureInlinePlayback(video);
    video.currentTime = clipPlayFrom(video.currentTime, range);
    video.muted = false;
    void video.play().catch(() => {
      // Sound refused here: play it muted rather than not at all.
      video.muted = true;
      void video.play().catch(() => {});
    });
  }

  function openFullscreen() {
    const video = videoRef.current;
    if (video) enterNativeVideoFullscreen(video);
  }

  const progress = range ? Math.min(1, Math.max(0, (time - range.start) / (range.end - range.start))) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} src={previewUrl} playsInline preload="auto" className="max-h-72 w-full rounded-xl bg-black" data-clip-preview />
        <button
          type="button"
          onClick={togglePlay}
          disabled={!range}
          aria-label={playing ? t("caddie.clipPause") : t("caddie.clipPlay")}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-fixed-white backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${playing ? "opacity-0" : "opacity-100"}`}
          >
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
          </span>
        </button>
        <button
          type="button"
          onClick={openFullscreen}
          aria-label={t("caddie.clipFullscreen")}
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-fixed-white backdrop-blur-sm">
            <Maximize2 size={15} aria-hidden="true" />
          </span>
        </button>
        {/* Where playback is within the analyzed section. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-fixed-white/25">
          <div className="h-full bg-fairway-400" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-2">
        <p className="text-center text-xs font-semibold text-fairway-700" data-clip-summary>
          {range
            ? range.trimmed
              ? t("caddie.clipRangeSummary", {
                  start: formatClock(range.start),
                  end: formatClock(range.end),
                  seconds: clipSeconds(range),
                })
              : t("caddie.clipWholeSummary", { seconds: clipSeconds(range) })
            : " "}
        </p>
        {action}
      </div>
    </div>
  );
}
