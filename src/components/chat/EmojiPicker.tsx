import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// A hand-picked common set rather than a full emoji library — keeps this
// lightweight per spec, and native glyphs render fine via the system font
// with zero extra dependencies or image assets.
const EMOJIS = [
  "😀", "😂", "😅", "🙂", "😊", "😍", "😘", "😜", "🤔", "😎",
  "🥳", "😢", "😭", "😡", "🥶", "🤝", "👍", "👎", "👏", "🙌",
  "🙏", "💪", "⛳", "🏌️", "🏆", "🎉", "🔥", "✅", "❌", "⭐",
  "💯", "☀️", "🌧️", "🍀", "🍺", "🥤", "☕", "😴", "🤙", "👋",
];

interface EmojiPickerProps {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

// Lightweight popover: click outside or Escape closes it, selecting an
// emoji doesn't close it (so multiple emoji in a row don't need reopening).
export function EmojiPicker({ triggerRef, onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, triggerRef]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      className="animate-pop absolute bottom-full left-0 z-20 mb-2 grid w-64 grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-lg"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          aria-label={`Insert ${emoji}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-lg transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
