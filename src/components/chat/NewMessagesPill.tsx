import { ArrowDown } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";

// "New messages" indicator for a chat whose reader is scrolled up when
// someone else's message arrives (lib/chatScroll.ts followNewMessages).
// Rendered as a zero-height in-flow anchor between the message list and the
// composer, so it always floats just above the composer whatever the
// composer's height, and adds nothing to the layout (the list keeps its
// size; no ResizeObserver fires for it). The button never takes focus: a tap
// keeps the composer focused and the keyboard up, like the send button.
export function NewMessagesPill({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <div className="relative h-0 shrink-0">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-fairway-700 shadow-md shadow-slate-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
      >
        <ArrowDown size={13} aria-hidden="true" /> {t("chat.newMessages")}
      </button>
    </div>
  );
}
