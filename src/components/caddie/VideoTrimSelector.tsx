import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";
import { formatClock } from "../../lib/format";
import { generateVideoFilmstrip } from "../../lib/image";

const MIN_WINDOW_SECONDS = 2; // a full swing (address through follow-through) rarely fits under this -- prevents dragging both handles down to a near-zero, useless selection
const FILMSTRIP_FRAME_COUNT = 10;
const HANDLE_WIDTH_PX = 14;

type DragMode = "start" | "end" | "middle" | null;

// A picked video longer than Caddie's clip-length cap used to just get
// rejected outright (see AnalyzeSwing.tsx's own MAX_SWING_VIDEO_SECONDS
// comment history) -- reported live as wanting to crop a long clip down
// rather than having to go find a separate trimming app first. Modeled
// after a standard mobile video editor's trim UI (reported live, with a
// reference screenshot): one filmstrip of real frames across the whole
// clip, a single draggable selection window over it (drag either edge to
// resize, drag the middle to shift both at once, preserving length), not
// two separate slider tracks. The window is passed to analyze-swing as
// startSeconds/endSeconds, which the existing frame-extraction pipeline
// already supports (see extract-frames.ts's "explicit window" path,
// previously only used for the adaptive dense pass) -- no client-side
// re-encoding needed, the original file uploads unchanged.
export function VideoTrimSelector({
  file,
  previewUrl,
  duration,
  maxSeconds,
  onConfirm,
  onCancel,
}: {
  file: File;
  previewUrl: string;
  duration: number;
  maxSeconds: number;
  onConfirm: (startSeconds: number, endSeconds: number) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const initialLength = Math.min(maxSeconds, duration);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(initialLength);
  const [previewTime, setPreviewTime] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[] | undefined>(undefined);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  // Real footage from a phone is often 60fps/high-resolution — seeking to
  // an arbitrary (non-keyframe) point means the browser has to decode
  // forward from the nearest preceding keyframe before it can actually
  // start playing, which reported live as "press play, nothing happens
  // for a while." That decode time is real and can't be eliminated here,
  // but a visible loading state at least confirms it's working rather
  // than looking stuck/broken.
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    generateVideoFilmstrip(file, FILMSTRIP_FRAME_COUNT)
      .then((frames) => {
        if (!cancelled) setThumbnails(frames);
      })
      .catch((err) => {
        console.error("Golf Me: failed to build a trim filmstrip.", err);
        if (!cancelled) setThumbnails([]); // falls back to a bare track, never blocks trimming
      });
    return () => {
      cancelled = true;
    };
    // file is a fresh object per pick (AnalyzeSwing never mutates it in place) -- safe to run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forces the preview to actually decode/paint the seeked-to frame -- see
  // captureVideoThumbnail's own comment on why currentTime alone isn't
  // enough on some mobile WebViews, especially when the value doesn't
  // change (e.g. staying at 0 on first mount).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    async function showFrame() {
      if (!video) return;
      video.currentTime = previewTime;
      try {
        await video.play();
        if (!cancelled) video.pause();
      } catch {
        // Best effort -- the seek above is what's left if autoplay is blocked.
      }
    }
    if (video.readyState >= 1) showFrame();
    else video.addEventListener("loadedmetadata", showFrame, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", showFrame);
    };
  }, [previewTime]);

  // Stops the preview exactly at the selected end, so "Preview crop" always
  // plays exactly the window that will actually be analyzed -- not the
  // whole source video running past it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function handleTimeUpdate() {
      if (video!.currentTime >= end) {
        video!.pause();
        setIsPreviewPlaying(false);
      }
    }
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [end]);

  function togglePreview() {
    const video = videoRef.current;
    if (!video || isPreviewLoading) return;
    if (isPreviewPlaying) {
      video.pause();
      setIsPreviewPlaying(false);
      return;
    }
    setIsPreviewLoading(true);
    // Waits for the seek to actually land before calling play() — starting
    // playback immediately would begin from wherever currentTime happened
    // to already be until the seek finishes, a visible stutter/jump on a
    // clip that takes a moment to seek in the first place.
    function onSeeked() {
      video!.removeEventListener("seeked", onSeeked);
      // A handle drag started while this was still seeking -- that drag's
      // own beginDrag already stopped any playing preview, so starting
      // playback now (from a since-superseded position) would just fight
      // with it.
      if (dragRef.current.mode) {
        setIsPreviewLoading(false);
        return;
      }
      video!
        .play()
        .then(() => {
          setIsPreviewPlaying(true);
          setIsPreviewLoading(false);
        })
        .catch(() => {
          // Autoplay can still be blocked in rare contexts; nothing more to
          // do here since this IS a direct user tap, not a background attempt.
          setIsPreviewLoading(false);
        });
    }
    video.addEventListener("seeked", onSeeked);
    // Always restarts from the current start, even if playback previously
    // stopped sitting right at the old end -- pressing play should always
    // mean "show me the crop from the top," not "resume from wherever."
    video.currentTime = start;
  }

  const dragRef = useRef<{ mode: DragMode; startAtDragBegin: number; endAtDragBegin: number; originClientX: number }>({
    mode: null,
    startAtDragBegin: 0,
    endAtDragBegin: 0,
    originClientX: 0,
  });

  function clientXToSeconds(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function beginDrag(mode: DragMode, e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, startAtDragBegin: start, endAtDragBegin: end, originClientX: e.clientX };
    // Dragging any handle while the crop preview is playing would otherwise
    // fight over the video's currentTime with the live-seek-while-dragging
    // behavior below.
    if (isPreviewPlaying) {
      videoRef.current?.pause();
      setIsPreviewPlaying(false);
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag.mode) return;
    if (drag.mode === "start") {
      const next = Math.max(0, Math.min(clientXToSeconds(e.clientX), end - MIN_WINDOW_SECONDS));
      setStart(next);
      if (end - next > maxSeconds) setEnd(next + maxSeconds);
      setPreviewTime(next);
    } else if (drag.mode === "end") {
      const next = Math.min(duration, Math.max(clientXToSeconds(e.clientX), start + MIN_WINDOW_SECONDS));
      setEnd(next);
      if (next - start > maxSeconds) setStart(next - maxSeconds);
      setPreviewTime(next);
    } else if (drag.mode === "middle") {
      const rect = trackRef.current?.getBoundingClientRect();
      const secondsPerPx = rect && rect.width > 0 ? duration / rect.width : 0;
      const deltaSeconds = (e.clientX - drag.originClientX) * secondsPerPx;
      const windowLength = drag.endAtDragBegin - drag.startAtDragBegin;
      const nextStart = Math.min(duration - windowLength, Math.max(0, drag.startAtDragBegin + deltaSeconds));
      setStart(nextStart);
      setEnd(nextStart + windowLength);
      setPreviewTime(nextStart);
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (dragRef.current.mode) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current.mode = null;
  }

  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 100;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4">
      <div>
        <p className="text-sm font-bold text-slate-900">{t("caddie.trimTitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("caddie.trimInstructions", { max: maxSeconds })}</p>
      </div>

      <div className="relative overflow-hidden rounded-xl">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} src={previewUrl} muted playsInline className="max-h-72 w-full rounded-xl bg-black" />
        <button
          type="button"
          onClick={togglePreview}
          aria-label={isPreviewPlaying ? t("caddie.trimPause") : t("caddie.trimPreview")}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
            {isPreviewLoading ? (
              <Loader2 size={22} className="animate-spin" />
            ) : isPreviewPlaying ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" className="ml-0.5" />
            )}
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* trackRef stays on this OUTER, unclipped element -- its bounding
            box is what clientXToSeconds measures against, and the edge
            handles (below) are its direct children so they can extend
            slightly past 0%/100% without being cut off. Everything that
            should visually clip to the rounded track (filmstrip, dim
            overlays, the middle drag box) lives in the INNER wrapper
            instead. Getting this backwards was a real bug caught live: at
            the default start=0, the left handle's `calc(0% - 14px)`
            position pushed half of it outside an overflow-hidden track,
            silently making it unclickable exactly where a user would
            first reach for it. */}
        <div ref={trackRef} className="relative h-16 touch-none select-none">
          <div className="absolute inset-0 overflow-hidden rounded-lg bg-slate-900">
            {thumbnails === undefined ? (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">…</div>
            ) : thumbnails.length > 0 ? (
              <div className="flex h-full w-full">
                {thumbnails.map((src, i) => (
                  <img key={i} src={src} alt="" draggable={false} className="h-full flex-1 object-cover" />
                ))}
              </div>
            ) : null}

            {/* Dim the excluded portions on either side of the selection. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: `${startPct}%` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/55" style={{ width: `${100 - endPct}%` }} />

            {/* The selection window itself -- dragging it shifts both edges together. */}
            <div
              className="absolute inset-y-0 cursor-grab border-y-2 border-fairway-400 bg-fairway-400/10 active:cursor-grabbing"
              style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
              onPointerDown={(e) => beginDrag("middle", e)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>

          {/* Edge handles -- each resizes just its own side. */}
          <div
            role="slider"
            aria-label={t("caddie.trimStartLabel")}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={start}
            className="absolute inset-y-0 flex cursor-ew-resize items-center justify-center rounded-l-md bg-fairway-500"
            style={{ left: `calc(${startPct}% - ${HANDLE_WIDTH_PX}px)`, width: HANDLE_WIDTH_PX }}
            onPointerDown={(e) => beginDrag("start", e)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="h-6 w-1 rounded-full bg-white/80" />
          </div>
          <div
            role="slider"
            aria-label={t("caddie.trimEndLabel")}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={end}
            className="absolute inset-y-0 flex cursor-ew-resize items-center justify-center rounded-r-md bg-fairway-500"
            style={{ left: `${endPct}%`, width: HANDLE_WIDTH_PX }}
            onPointerDown={(e) => beginDrag("end", e)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="h-6 w-1 rounded-full bg-white/80" />
          </div>
        </div>
        <p className="text-center text-xs font-semibold text-slate-600">
          {t("caddie.trimSelectedLabel", { start: formatClock(start), end: formatClock(end) })}
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1">
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onConfirm(start, end)} className="flex-1">
          {t("caddie.trimConfirm")}
        </Button>
      </div>
    </div>
  );
}
