import { Loader2, RotateCcw, VideoOff } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { canRetryVideo, videoFailureMessageKey } from "../../lib/videoPlayback";
import type { VideoPlaybackStatus } from "./useVideoPlayback";

// Sits over a <video> inside its (relative) box. Loading: a small spinner
// that never blocks taps. Failure: a clear message instead of a black box,
// with Retry only when retrying can help (a network failure) — never for a
// link that is gone/forbidden or a file this device can't decode.
export function VideoStatusOverlay({ status, onRetry }: { status: VideoPlaybackStatus; onRetry: () => void }) {
  const { t } = useLocale();
  if (status.phase === "ok") return null;
  if (status.phase === "loading" || status.phase === "checking") {
    return (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label={t("media.videoLoading")} data-video-status="loading">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white">
          <Loader2 size={22} className="animate-spin" />
        </span>
      </span>
    );
  }
  const retryable = canRetryVideo(status.failure);
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-white"
      role="alert"
      data-video-status={status.failure}
      // A tap on the message must not fall through to the video's own
      // tap-to-fullscreen / tap-to-play handlers.
      onClick={(e) => e.stopPropagation()}
    >
      <VideoOff size={24} className="opacity-80" aria-hidden />
      <p className="max-w-xs text-sm font-medium">{t(videoFailureMessageKey(status.failure))}</p>
      {retryable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900"
        >
          <RotateCcw size={14} aria-hidden /> {t("loading.retry")}
        </button>
      )}
    </div>
  );
}
