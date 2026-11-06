import { Loader2, X } from "lucide-react";
import type { AttachmentState } from "../../lib/chatImages";

// The picked photo above the composer, before sending: a small preview (or
// a spinner while it's being re-encoded) and a remove button. Sits inside
// the composer's own container like the reply bar, so the thread's list /
// docked-bar ResizeObservers see it as the composer growing. Its buttons
// never take focus off the textarea, so the keyboard stays where it is.
export function ImageAttachmentChip({
  state,
  onRemove,
  labels,
}: {
  state: AttachmentState;
  onRemove: () => void;
  labels: { remove: string; processing: string; ready: string };
}) {
  if (state.kind === "none") return null;
  const ready = state.kind === "ready" ? state.image : null;
  return (
    <div data-chat-attachment className="flex items-center gap-2 border-t border-slate-100 py-2 pr-2 pl-3">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {ready ? (
          <img src={ready.previewUrl} alt={labels.ready} draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-400" role="status" aria-label={labels.processing}>
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{ready ? labels.ready : labels.processing}</p>
      <button
        type="button"
        aria-label={labels.remove}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
      >
        <X size={16} />
      </button>
    </div>
  );
}
