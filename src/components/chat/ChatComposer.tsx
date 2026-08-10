import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Send, Smile } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";

const MAX_TEXTAREA_HEIGHT_PX = 120;

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
}

// Shared by DirectMessageThread and GroupChat. Auto-expanding textarea
// (Enter sends, Shift+Enter inserts a newline, capped height then scrolls
// internally), a desktop-only emoji button that inserts at the current
// cursor position, and a 16px+ font at mobile widths (text-base, stepping
// down to text-sm at sm:) so iOS Safari never auto-zooms the page on focus.
export function ChatComposer({ value, onChange, onSend, placeholder = "Type a message..." }: ChatComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [value]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + emoji);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      const caret = start + emoji.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex items-end gap-2 border-t border-slate-100 px-3 py-2.5">
      <div className="relative hidden shrink-0 sm:block">
        <button
          ref={emojiButtonRef}
          type="button"
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Add emoji"
          aria-expanded={emojiOpen}
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-fairway-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <Smile size={18} />
        </button>
        {emojiOpen && <EmojiPicker triggerRef={emojiButtonRef} onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="max-h-[120px] flex-1 resize-none overflow-y-auto rounded-2xl bg-slate-100 px-3.5 py-2 text-base leading-snug outline-none focus:bg-slate-50 focus:ring-2 focus:ring-fairway-100 sm:text-sm"
      />
      <button
        onClick={onSend}
        disabled={!value.trim()}
        aria-label="Send message"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-white transition-all duration-200 ease-out hover:bg-fairway-700 hover:-translate-y-px active:translate-y-0 active:bg-fairway-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Send size={15} />
      </button>
    </div>
  );
}
