import { Reply, X } from "lucide-react";
import type { MessageTimeLabel } from "../../lib/messageTime";

// Pieces of a chat bubble that look exactly like DirectMessageThread's own
// inline markup (same classes, same DOM), for round chat (GroupChat). The
// DM thread keeps its inline copy for now (the file is frozen); it can
// adopt these later, render-only, without touching its keyboard/viewport
// code.

// The quote at the top of a reply bubble. `quoted` null = the original isn't
// loaded here (or is gone): "Original message unavailable".
export function MessageQuote({
  isMe,
  quoted,
  onJump,
  labels,
}: {
  isMe: boolean;
  quoted: { id: string; sender: string; text: string; unsent: boolean } | null;
  onJump: (id: string) => void;
  labels: { showOriginal: string; unavailable: string; unsent: string };
}) {
  if (!quoted) {
    return (
      <div
        className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs italic ${
          isMe ? "border-white/50 bg-white/10 text-white/80" : "border-slate-300 bg-white/70 text-slate-500"
        }`}
      >
        {labels.unavailable}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(quoted.id)}
      aria-label={labels.showOriginal}
      className={`mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs ${
        isMe ? "border-white/70 bg-white/15 text-white/90" : "border-fairway-500 bg-white/80 text-slate-600"
      }`}
    >
      <span className={`block font-semibold ${isMe ? "text-white" : "text-slate-700"}`}>{quoted.sender}</span>
      <span className={`line-clamp-2 ${quoted.unsent ? "italic" : ""}`}>{quoted.unsent ? labels.unsent : quoted.text}</span>
    </button>
  );
}

// "Replying to <name>" above the composer, with a cancel button that never
// takes focus off the textarea (the keyboard stays up).
export function ReplyBar({ title, text, cancelLabel, onCancel }: { title: string; text: string; cancelLabel: string; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-slate-100 py-2 pr-2 pl-3">
      <Reply size={14} className="shrink-0 text-fairway-600" aria-hidden="true" />
      <div className="min-w-0 flex-1 border-l-2 border-fairway-500 pl-2 text-xs leading-snug">
        <p className="truncate font-semibold text-slate-700">{title}</p>
        <p className="truncate text-slate-500">{text}</p>
      </div>
      <button
        type="button"
        aria-label={cancelLabel}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// "Edited" after a text message's words (lib/messageEdit.ts), inside the
// bubble, in the bubble's own muted colour. Inline text, no box of its own.
export function EditedMark({ isMe, label }: { isMe: boolean; label: string }) {
  return <span className={`ml-1.5 text-[10px] font-medium whitespace-nowrap ${isMe ? "text-white/70" : "text-slate-400"}`}>{label}</span>;
}

// The send time each row keeps just past the list's right clip edge, shown
// by useSwipeToRevealTimes (drag the thread left).
export function RevealedTime({ dateTime, label }: { dateTime: string; label: MessageTimeLabel | null }) {
  if (!label) return null;
  return (
    <time
      dateTime={dateTime}
      className="pointer-events-none absolute top-1/2 left-[calc(100%+1rem)] flex w-[4.25rem] -translate-y-1/2 flex-col items-center text-center text-[10px] leading-tight whitespace-nowrap text-slate-400 tabular-nums"
    >
      {label.day && <span>{label.day}</span>}
      <span className="text-[11px] font-medium text-slate-500">{label.time}</span>
    </time>
  );
}
