import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";
import { formatClock } from "../../lib/format";

const MIN_WINDOW_SECONDS = 2; // a full swing (address through follow-through) rarely fits under this -- prevents dragging both handles down to a near-zero, useless selection

// A picked video longer than Caddie's clip-length cap used to just get
// rejected outright (see AnalyzeSwing.tsx's own MAX_SWING_VIDEO_SECONDS
// comment history) -- reported live as wanting to crop a long clip down
// rather than having to go find a separate trimming app first. Both ends
// are independently draggable (reported live: the start of the selected
// window needed cropping too, not just where a fixed-length window
// began) -- start/end each clamp the other so the window never exceeds
// maxSeconds or drops under MIN_WINDOW_SECONDS. The window is passed to
// analyze-swing as startSeconds/endSeconds, which the existing
// frame-extraction pipeline already supports (see extract-frames.ts's
// "explicit window" path, previously only used for the adaptive dense
// pass) -- no client-side re-encoding needed, the original file uploads
// unchanged.
export function VideoTrimSelector({
  previewUrl,
  duration,
  maxSeconds,
  onConfirm,
  onCancel,
}: {
  previewUrl: string;
  duration: number;
  maxSeconds: number;
  onConfirm: (startSeconds: number, endSeconds: number) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialLength = Math.min(maxSeconds, duration);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(initialLength);

  // Seeks the preview to whichever handle moved, so dragging either one
  // shows the actual frame at that point rather than a static thumbnail.
  const [previewTime, setPreviewTime] = useState(0);

  function handleStartChange(next: number) {
    const clampedStart = Math.max(0, Math.min(next, end - MIN_WINDOW_SECONDS));
    setStart(clampedStart);
    if (end - clampedStart > maxSeconds) setEnd(clampedStart + maxSeconds);
    setPreviewTime(clampedStart);
  }

  function handleEndChange(next: number) {
    const clampedEnd = Math.min(duration, Math.max(next, start + MIN_WINDOW_SECONDS));
    setEnd(clampedEnd);
    if (clampedEnd - start > maxSeconds) setStart(clampedEnd - maxSeconds);
    setPreviewTime(clampedEnd);
  }
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    async function showFrame() {
      if (!video) return;
      video.currentTime = previewTime;
      // Some mobile WebViews (notably iOS) leave the canvas fully black
      // until the video actually decodes a frame through playback -- a
      // currentTime assignment alone doesn't guarantee a repaint,
      // especially when the value doesn't change (e.g. staying at 0).
      // Muted autoplay is allowed without a user gesture; pausing again
      // immediately after keeps this a static preview, not a playing video.
      try {
        await video.play();
        if (!cancelled) video.pause();
      } catch {
        // Autoplay can still be blocked in rare contexts -- the seek above
        // is the best effort left in that case.
      }
    }
    if (video.readyState >= 1) showFrame();
    else video.addEventListener("loadedmetadata", showFrame, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", showFrame);
    };
  }, [previewTime]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4">
      <div>
        <p className="text-sm font-bold text-slate-900">{t("caddie.trimTitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("caddie.trimInstructions", { max: maxSeconds })}</p>
      </div>

      <div className="overflow-hidden rounded-xl">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} src={previewUrl} muted playsInline className="max-h-72 w-full rounded-xl bg-black" />
      </div>

      <div className="flex flex-col gap-2.5">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t("caddie.trimStartLabel")} · {formatClock(start)}
          </label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={start}
            onChange={(e) => handleStartChange(Number(e.target.value))}
            className="w-full accent-fairway-600"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t("caddie.trimEndLabel")} · {formatClock(end)}
          </label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={end}
            onChange={(e) => handleEndChange(Number(e.target.value))}
            className="w-full accent-fairway-600"
          />
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
