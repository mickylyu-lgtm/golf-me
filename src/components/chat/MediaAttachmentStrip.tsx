import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Play, Scissors, X } from "lucide-react";
import { VideoTrimSelector } from "../caddie/VideoTrimSelector";
import { VIDEO_MAX_MS, formatVideoDuration, videoDurationToSend, type MediaAttachmentItem } from "../../lib/chatMedia";
import { FullscreenMediaViewer } from "../community/FullscreenMediaViewer";
import { draftMediaPreview } from "../../lib/draftMediaPreview";
import { pushModal } from "../../lib/modalStack";

// The picked photos / videos above the composer, before sending: a
// horizontal strip of chips (thumbnail, a video's length, a spinner while
// it's prepared) with a remove button each. Sits inside the composer's own
// container like the reply bar (and the single-photo chip before it), so
// the thread's list / docked-bar ResizeObservers see it as the composer
// growing; one row tall whatever the count (it scrolls sideways). Its
// remove buttons preserve composer focus; opening a preview moves focus into the dialog.
export function MediaAttachmentStrip({
  items,
  onRemove,
  labels,
}: {
  items: readonly MediaAttachmentItem[];
  onRemove: (key: string) => void;
  labels: { openPhoto: string; openVideo: string; removePhoto: string; removeVideo: string; processing: string; photoReady: string; videoReady: string; needsTrim: string; count: (n: number) => string };
}) {
  // Keep only an identity, never a second attachment or object URL owner.
  // Removal, send, or a conversation change invalidates the preview immediately.
  const [selected, setSelected] = useState<MediaAttachmentItem | null>(null);
  const preview = draftMediaPreview(items, selected);
  useEffect(() => {
    // Do not retain a removed video's File in the still-mounted composer.
    if (selected && !items.includes(selected)) setSelected(null);
  }, [items, selected]);
  if (items.length === 0) return null;
  const single = items.length === 1;
  return (
    <>
    <div data-chat-attachment className="flex items-center gap-2 border-t border-slate-100 py-2 pr-2 pl-3">
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none]" data-no-swipe>
        {items.map((it) => {
          const thumb = it.state === "processing" ? null : it.kind === "image" ? it.image.previewUrl : it.video.posterUrl;
          const isVideo = it.kind === "video";
          return (
            <div key={it.key} data-media-chip={it.kind} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
              <button
                type="button"
                disabled={it.state !== "ready"}
                aria-label={isVideo ? labels.openVideo : labels.openPhoto}
                aria-haspopup="dialog"
                onClick={() => setSelected(it)}
                className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fairway-400 disabled:cursor-default"
              >
              {it.state === "processing" ? (
                <span className="flex h-full w-full items-center justify-center text-slate-400" role="status" aria-label={labels.processing}>
                  <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                </span>
              ) : thumb ? (
                <img src={thumb} alt={isVideo ? labels.videoReady : labels.photoReady} draggable={false} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-slate-800 text-fixed-white" aria-label={labels.videoReady} role="img">
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                </span>
              )}
              {isVideo && it.state !== "processing" && (
                <span className="pointer-events-none absolute bottom-0.5 left-0.5 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-fixed-white tabular-nums">
                  {it.state === "trimming" ? <Scissors size={9} aria-hidden="true" /> : null}
                  {it.state === "trimming" ? formatVideoDuration(VIDEO_MAX_MS) : formatVideoDuration(videoDurationToSend(it.video))}
                </span>
              )}
              </button>
              {!single && (
                <button
                  type="button"
                  aria-label={isVideo ? labels.removeVideo : labels.removePhoto}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onRemove(it.key)}
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-fixed-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {single ? (
        <>
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {items[0].state === "processing"
              ? labels.processing
              : items[0].state === "trimming"
                ? labels.needsTrim
                : items[0].kind === "video"
                  ? labels.videoReady
                  : labels.photoReady}
          </p>
          <button
            type="button"
            aria-label={items[0].kind === "video" ? labels.removeVideo : labels.removePhoto}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemove(items[0].key)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
          >
            <X size={16} />
          </button>
        </>
      ) : (
        <span className="shrink-0 text-[11px] font-semibold text-slate-500 tabular-nums">{labels.count(items.length)}</span>
      )}
    </div>
    {preview && <FullscreenMediaViewer media={[preview]} onClose={() => setSelected(null)} />}
    </>
  );
}

// A picked video longer than 60 s: the Caddie trim selector (reused) in a
// sheet, to pick which part to send. Cancel removes that video.
export function ChatVideoTrimSheet({
  item,
  onConfirm,
  onCancel,
  labels,
}: {
  item: Extract<MediaAttachmentItem, { state: "trimming" }>;
  onConfirm: (startMs: number, endMs: number) => void;
  onCancel: () => void;
  labels: { title: string; instructions: string; confirm: string };
}) {
  useEffect(() => {
    const entry = pushModal();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && entry.isTop()) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      entry.release();
    };
  }, [onCancel]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={labels.title} data-no-swipe data-chat-trim className="fixed inset-0 z-[96] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:px-0 sm:pb-0">
        <VideoTrimSelector
          file={item.video.file}
          previewUrl={item.video.localUrl}
          duration={item.video.sourceDurationMs / 1000}
          maxSeconds={VIDEO_MAX_MS / 1000}
          labels={labels}
          onConfirm={(start, end) => onConfirm(start * 1000, end * 1000)}
          onCancel={onCancel}
        />
      </div>
    </div>,
    document.body,
  );
}
