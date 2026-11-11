import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ImagePlus, Keyboard, Mic, Send, Smile } from "lucide-react";
import { HoldToTalk, type HoldToTalkLabels, type SentVoiceClip, type VoiceNotice, type VoiceOrigin } from "./HoldToTalk";
import { voiceRecordingAvailable } from "../../lib/voiceRecorder";
import { EmojiPicker } from "./EmojiPicker";
import { isSendEnter } from "../../lib/isImeComposing";
import { composerTextareaHeight } from "../../lib/composerAutosize";
import { createSendGuard } from "../../lib/sendGuard";
import { draftSendKey } from "../../lib/chatImages";
import { pickChatMedia, pickChatMediaFiles } from "../../lib/chatMediaPicker";
import { MEDIA_MAX_ITEMS, VIDEO_STAGED_MAX_BYTES } from "../../lib/chatMedia";

// Font, line-height and padding shared by the textarea and its hidden
// measuring mirror: the mirror only measures correctly while these match.
const TEXTAREA_METRICS = "px-3.5 py-2 text-base leading-snug sm:text-sm";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  // An inline edit owns text entry; retain this composer and its draft.
  disabled?: boolean;
  placeholder?: string;
  onBlur?: () => void;
  // Photos (lib/chatImages.ts). The photo button shows only when the page
  // passes onPickImage (it does so once the feature is available). A
  // processed photo's key makes Send work with no text, and is part of what
  // the one-send-per-draft guard compares; photoBusy (still re-encoding)
  // holds Send until it's ready.
  onPickImage?: (file: File) => void;
  photoLabel?: string;
  photoKey?: string | null;
  photoBusy?: boolean;
  // Videos and albums (lib/chatMedia.ts): when the page passes onPickFiles,
  // the same button hands over every picked File (photos and videos, up to
  // the page's limit) instead of one photo; mediaAccept / mediaMultiple set
  // the web file input (feature-detected by the page).
  onPickFiles?: (files: File[]) => void;
  mediaAccept?: string;
  mediaMultiple?: boolean;
  /** The native picker refused a video over the staging limit (200 MiB). */
  onMediaTooLarge?: () => void;
  // Voice messages (lib/chatVoice.ts): passed once the page can send them;
  // the toggle then shows where this browser can record.
  voice?: {
    /** The conversation this composer sends to; each recording keeps the one it started in. */
    origin: VoiceOrigin;
    onClip: (clip: SentVoiceClip) => void;
    onNotice: (notice: VoiceNotice, origin?: VoiceOrigin | null) => void;
    labels: HoldToTalkLabels & { toVoice: string; toKeyboard: string };
  };
}

// Shared by DirectMessageThread and GroupChat. Auto-expanding textarea
// (Enter sends, Shift+Enter inserts a newline, grows up to
// COMPOSER_MAX_LINES lines then scrolls internally), a desktop-only emoji
// button that inserts at the current cursor position, and a 16px+ font at
// mobile widths (text-base, stepping down to text-sm at sm:) so iOS Safari
// never auto-zooms the page on focus.
//
// Growth only ever changes this component's own height; the pages keep
// their bottom edge where it is (DirectMessageThread: a fixed-height box,
// GroupChat: a bar fixed above the keyboard), so extra lines push the
// composer's TOP up. The height is measured on a hidden mirror, never by
// collapsing the real textarea (lib/composerAutosize.ts says why).
export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  onBlur,
  onPickImage,
  photoLabel = "Add a photo",
  photoKey = null,
  photoBusy = false,
  onPickFiles,
  mediaAccept = "image/*",
  mediaMultiple = false,
  onMediaTooLarge,
  voice,
}: ChatComposerProps) {
  const pickOne = onPickFiles ? (file: File) => onPickFiles([file]) : onPickImage;
  const tappedPickRef = useRef<((files: File[]) => void) | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [canVoice] = useState(voiceRecordingAvailable);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceOn = Boolean(voice && canVoice);
  if (voiceMode && !voiceOn) setVoiceMode(false);
  // Into voice: the keyboard goes down (nothing to type). Back to the
  // keyboard: just show the textarea again, unfocused -- the keyboard only
  // comes up when the user taps the textarea.
  function toggleVoice() {
    const el = textareaRef.current;
    if (!voiceMode) {
      setVoiceMode(true);
      if (el && document.activeElement === el) el.blur();
    } else {
      setVoiceMode(false);
    }
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the textarea had focus when the send button was pressed.
  const focusedAtPressRef = useRef(false);
  const sendGuardRef = useRef(createSendGuard());

  // Layout effect: the new height lands in the same frame as the new text
  // (and the list's ResizeObserver re-pin with it), never a frame later.
  useLayoutEffect(() => {
    sendGuardRef.current.release();
    const el = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    const resize = () => {
      mirror.style.width = `${el.offsetWidth}px`;
      mirror.value = el.value;
      const cs = window.getComputedStyle(el);
      const height = composerTextareaHeight({
        contentHeight: mirror.scrollHeight,
        lineHeight: parseFloat(cs.lineHeight),
        paddingY: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
        borderY: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
      });
      const next = `${height}px`;
      // Only a real change touches the textarea, so typing within a line
      // causes no layout work above it at all.
      if (el.style.height !== next) el.style.height = next;
    };
    resize();
    // Width changes (rotation, window resize, the desktop emoji button
    // appearing at sm:) re-wrap the text: measure again. Height changes are
    // ours and ignored, so this never loops.
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  useLayoutEffect(() => {
    if (disabled) setEmojiOpen(false);
  }, [disabled]);

  // A different photo (picked, removed, or taken by a send) is a new draft.
  useLayoutEffect(() => {
    sendGuardRef.current.release();
  }, [photoKey]);

  function send() {
    // One send per draft (lib/sendGuard.ts): Enter and the button can't
    // both send the same text (or the same photo) before the page clears it.
    if (disabled || photoBusy) return;
    if (!sendGuardRef.current.claim(draftSendKey(value, photoKey))) return;
    onSend();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Not while an IME is composing: that Enter confirms a candidate.
    if (isSendEnter(e)) {
      e.preventDefault();
      send();
    }
  }

  // Sending keeps the cursor in the textbox and the keyboard open, like
  // iMessage/WhatsApp. Tapping a <button> normally moves focus off the
  // textarea (its mousedown default action), which on iOS closes the
  // keyboard after every send. preventDefault on mousedown stops that focus
  // move; click still fires, and keyboard Enter/Space on the button still
  // works. As a fallback (if a WebView moves focus anyway), the textarea is
  // refocused synchronously inside the same tap -- iOS only shows the
  // keyboard for a focus() made within a user gesture -- and only when it
  // had focus at press time, so a send never opens a closed keyboard.
  function handleSendClick() {
    if (disabled) return;
    const wasFocused = focusedAtPressRef.current;
    focusedAtPressRef.current = false;
    send();
    const el = textareaRef.current;
    if (wasFocused && el && document.activeElement !== el) el.focus({ preventScroll: true });
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
    <div className="relative flex items-end gap-2 border-t border-slate-100 px-3 py-2.5">
      {/* Voice (WeChat-style, lib/chatVoice.ts): bottom-left toggle between
          the keyboard and "Hold to talk". Only where this browser can record
          (voiceRecordingAvailable) and the page passes `voice`. Same 36 px
          button as the others: the row's height doesn't change. */}
      {voice && canVoice && (
        <button
          type="button"
          onClick={toggleVoice}
          aria-label={voiceMode ? voice.labels.toKeyboard : voice.labels.toVoice}
          title={voiceMode ? voice.labels.toKeyboard : voice.labels.toVoice}
          aria-pressed={voiceMode}
          data-chat-voice-toggle
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-fairway-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          {voiceMode ? <Keyboard size={18} /> : <Mic size={18} />}
        </button>
      )}
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
      {/* Photo: in the native app, the one-tap system photo picker
          (lib/chatMediaPicker.ts); elsewhere the hidden file input below
          (library or camera; no `capture`, which would force it). One per
          message. Same 36 px as the emoji button and shorter than the
          one-line textarea, so the row's height (and the composer's
          docking) is unchanged; the textarea just gets narrower. */}
      {pickOne && (
        <>
          <button
            type="button"
            onClick={() => {
              const openFileInput = () => fileInputRef.current?.click();
              if (onPickFiles) {
                // Photos + videos, several at once: native in 2.5+ builds
                // (lib/mediaPicker.ts capability check); 2.4 and the web
                // open the file input below. The handler is the one of
                // THIS tap (the page binds it to the chat visit), also for
                // the web input's later change event.
                tappedPickRef.current = onPickFiles;
                void pickChatMediaFiles({
                  kinds: mediaAccept.includes("video") ? ["image", "video"] : ["image"],
                  limit: mediaMultiple ? MEDIA_MAX_ITEMS : 1,
                  maxVideoBytes: VIDEO_STAGED_MAX_BYTES,
                  onTooLarge: onMediaTooLarge,
                  openFileInput,
                  onPicked: onPickFiles,
                });
              } else void pickChatMedia({ openFileInput, onPicked: pickOne });
            }}
            aria-label={photoLabel}
            title={photoLabel}
            data-chat-photo-button
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-fairway-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
          >
            <ImagePlus size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={mediaAccept}
            multiple={mediaMultiple || undefined}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              // Cleared so picking the same photo again still fires.
              e.target.value = "";
              if (files.length === 0) return;
              const handler = tappedPickRef.current ?? onPickFiles;
              tappedPickRef.current = null;
              if (handler) handler(files);
              else pickOne(files[0]);
            }}
          />
        </>
      )}
      {/* The textarea's flex slot. A plain wrapper (same flex-1, the
          textarea fills it), so the voice bar can cover exactly the
          textarea's box without touching its size or the autosize code. */}
      <div className="relative flex min-w-0 flex-1 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={1}
          aria-hidden={voiceMode ? true : undefined}
          tabIndex={voiceMode ? -1 : undefined}
          className={`flex-1 resize-none overflow-y-auto rounded-2xl bg-slate-100 outline-none focus:bg-slate-50 focus:ring-2 focus:ring-fairway-100 ${TEXTAREA_METRICS} ${voiceMode ? "invisible" : ""}`}
        />
        {voiceMode && voice && <HoldToTalk origin={voice.origin} onClip={voice.onClip} onNotice={voice.onNotice} labels={voice.labels} />}
      </div>
      {/* Measuring mirror (see the layout effect): same metrics, out of
          flow, invisible, unfocusable and hidden from assistive tech. */}
      <textarea
        ref={mirrorRef}
        aria-hidden="true"
        tabIndex={-1}
        readOnly
        rows={1}
        className={`pointer-events-none invisible absolute top-0 left-0 h-0 resize-none overflow-hidden ${TEXTAREA_METRICS}`}
      />
      <button
        onPointerDown={() => {
          focusedAtPressRef.current = document.activeElement === textareaRef.current;
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleSendClick}
        disabled={disabled || photoBusy || (!value.trim() && !photoKey)}
        // Medium haptic per send in the native app. Only an attribute read by
        // lib/tapFeedback's document click listener: no handler, no focus or
        // keyboard effect.
        data-haptic="medium"
        aria-label="Send message"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-white transition-all duration-200 ease-out hover:bg-fairway-700 hover:-translate-y-px active:translate-y-0 active:bg-fairway-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Send size={15} />
      </button>
    </div>
  );
}
