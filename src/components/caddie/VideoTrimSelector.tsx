import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import { Button } from "../ui/Button";
import { formatClock } from "../../lib/format";

// A picked video longer than Caddie's clip-length cap used to just get
// rejected outright (see AnalyzeSwing.tsx's own MAX_SWING_VIDEO_SECONDS
// comment history) -- reported live as wanting to crop a long clip down
// rather than having to go find a separate trimming app first. One handle,
// not two: dragging picks where a FIXED-length (maxSeconds) window starts,
// which covers the actual need (pick which part of a longer video to
// analyze) without a full dual-handle timeline editor. The window is
// passed to analyze-swing as startSeconds/endSeconds, which the existing
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
  const windowLength = Math.min(maxSeconds, duration);
  const maxStart = Math.max(0, duration - windowLength);
  const [start, setStart] = useState(0);
  const end = Math.min(duration, start + windowLength);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.currentTime = start;
  }, [start]);

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

      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={maxStart}
          step={0.1}
          value={start}
          onChange={(e) => setStart(Number(e.target.value))}
          disabled={maxStart <= 0}
          className="w-full accent-fairway-600"
        />
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
