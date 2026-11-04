import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { ChatComposer } from "./ChatComposer";
import { groupChatDraftKey, loadChatDraft, saveChatDraft } from "../../lib/chatDraft";
import { useLocale } from "../../i18n/LocaleContext";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import { useComposerFocus } from "../../lib/useComposerFocus";
import { focusMovedToOtherField } from "../../lib/composerFocus";
import { isNearBottom, pinToBottom, shouldPinToBottom } from "../../lib/chatScroll";
import { lockPageScroll } from "../../lib/scrollLock";
import type { ChatMessage } from "../../types";

// layout "card" (default): the inline card on the round page, list capped
// at max-h-96. "page": the full-screen /messages/round/:id thread -- same
// card, the list just fills the screen (svh: the small viewport, which the
// keyboard never changes, so docking below works exactly as in the card).
// Callers only render this for members (lib/roundChat.ts canReadRoundChat).
const PAGE_LIST_HEIGHT = "calc(100svh - 18rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))";

export function GroupChat({ callId, layout = "card" }: { callId: string; layout?: "card" | "page" }) {
  const { currentUser, getGolfer, getGolfCall, messagesForCall, sendMessage, retryRoundMessage, discardRoundMessage } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [text, setText] = useState(() => loadChatDraft(groupChatDraftKey(callId)));
  const listRef = useRef<HTMLDivElement>(null);
  const messages = messagesForCall(callId);
  // Completed / cancelled: history stays, the composer is replaced by a
  // read-only note (the round_messages insert policy refuses posts too).
  const status = getGolfCall(callId)?.status;
  const readOnly = status === "completed" || status === "cancelled";
  const readOnlyNote = status === "cancelled" ? t("roundChat.cancelledReadOnly") : t("roundChat.endedReadOnly");

  // iOS keyboard (capacitor.config.ts Keyboard resize:"body"): that mode
  // only shrinks document.body's inline height -- the WebView, 100dvh and
  // position:fixed stay full-screen, so the keyboard simply covers this
  // composer (it sits mid/low on the round page) and iOS drags the whole
  // screen up to reveal it. While the keyboard is open the composer is
  // docked instead, same pattern as PostDetail's comment box: GroupChat's
  // own wrapper (the shared ChatComposer itself is untouched, and never
  // remounted -- focus and the keyboard stay) becomes a fixed bar sitting
  // exactly on top of the keyboard, a measured in-flow spacer holds its
  // place so the page doesn't shift, and the page behind is scroll-locked.
  // keyboardHeight comes from the plugin's own events and is always 0 on
  // web, where nothing here changes.
  const keyboardHeight = useKeyboardHeight();
  const composerRef = useRef<HTMLDivElement>(null);
  // Docked only while the keyboard is this composer's (useComposerFocus):
  // a sheet's textarea on the round page opening it leaves the chat and
  // the page alone. Never docked while read-only: there's no composer.
  const composerOwnsFocus = useComposerFocus(composerRef, rememberScrollBeforeKeyboard);
  const composerDocked = !readOnly && composerOwnsFocus && keyboardHeight > 0;
  const [composerHeight, setComposerHeight] = useState(0);

  // Measured on docking, before paint, so the spacer is never a frame late.
  useLayoutEffect(() => {
    if (composerDocked && composerRef.current) setComposerHeight(composerRef.current.offsetHeight);
  }, [composerDocked]);

  // Page scroll position captured when the composer gets focus, before the
  // keyboard starts opening. iOS may pan the page to reveal the textbox in
  // the moment before the composer docks; if it did, the page is put back
  // to exactly where it was once docked, and again when the keyboard
  // closes. Local to this component only -- not the removed app-wide
  // scrollTo(0,0) hack.
  const scrollYBeforeKeyboardRef = useRef<number | null>(null);
  // Where the composer sat in the page (document coordinates), so docking
  // can bring the content just above it -- the latest messages/comments --
  // right above the docked bar instead of leaving the view wherever it was.
  const composerPageTopRef = useRef<number | null>(null);
  function rememberScrollBeforeKeyboard() {
    if (composerDocked) return;
    scrollYBeforeKeyboardRef.current = window.scrollY;
    const rect = composerRef.current?.getBoundingClientRect();
    composerPageTopRef.current = rect ? rect.top + window.scrollY : null;
  }

  // Layout effect, not a passive one: the scroll lock and the restore to the
  // saved position must land before the docked layout paints, or the
  // iOS-panned page could flash for a frame before snapping back.
  useLayoutEffect(() => {
    if (!composerDocked) return;
    const releaseScroll = lockPageScroll();
    const composerEl = composerRef.current;
    // Line the composer's old spot up with the top of the docked bar, so
    // what was right above it stays visible right above the keyboard. The
    // page is put back where it was when the keyboard closes.
    const list = listRef.current;
    if (list) pinToBottom(list);
    const composerTop = composerPageTopRef.current;
    const dockedHeight = composerRef.current?.offsetHeight ?? 0;
    if (composerTop !== null) {
      window.scrollTo(0, Math.max(0, composerTop - (window.innerHeight - keyboardHeight - dockedHeight)));
    } else {
      const saved = scrollYBeforeKeyboardRef.current;
      if (saved !== null && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    }
    return () => {
      releaseScroll();
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      composerPageTopRef.current = null;
      // Not when another field took the keyboard (it's revealed on its own).
      const active = document.activeElement as HTMLElement | null;
      if (focusMovedToOtherField(active, !!active && !!composerEl?.contains(active))) return;
      if (restoreTo !== null) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
    // keyboardHeight is final when the composer docks (keyboardWillShow);
    // re-running on later height changes would re-scroll mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDocked]);

  // New messages follow the DM thread's rule (lib/chatScroll.ts): pin the
  // list to the bottom only if the reader was already near it, or for the
  // message they just sent. Only the list's own scrollTop moves, docked or
  // not -- the old scrollIntoView also scrolled the window, dragging the
  // round page to the chat card on load and on every incoming message.
  // Starts true so the first load opens at the newest message.
  const nearBottomRef = useRef(true);
  const justSentRef = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      nearBottomRef.current = isNearBottom(el);
    };
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el && shouldPinToBottom({ nearBottom: nearBottomRef.current, justSent: justSentRef.current })) pinToBottom(el);
    justSentRef.current = false;
  }, [messages.length]);

  // Same golf call's chat can be revisited across navigations without this
  // component staying mounted the whole time — restore whatever was typed
  // but never sent, instead of always starting from a blank box.
  useEffect(() => {
    setText(loadChatDraft(groupChatDraftKey(callId)));
  }, [callId]);

  function updateText(value: string) {
    setText(value);
    saveChatDraft(groupChatDraftKey(callId), value);
  }

  // Content filter: the message was removed, so put the text back (unless
  // the golfer already started typing something new) to edit.
  function restoreRejectedText(sending: string) {
    showToast(t("moderation.objectionableContent"), "warning");
    setText((current) => {
      if (current.trim()) return current;
      saveChatDraft(groupChatDraftKey(callId), sending);
      return sending;
    });
  }

  async function handleSend() {
    const sending = text;
    if (!sending.trim() || readOnly) return;
    // Clear right away: the message shows at once (real accounts: as
    // "sending", then a "Not sent · Tap to retry" bubble if it fails, so the
    // text is never silently lost; demo: delivered instantly).
    updateText("");
    // The bubble is added synchronously (demo and real), so the message
    // effect above sees this and pins the golfer's own message into view.
    justSentRef.current = true;
    const result = await sendMessage(callId, sending);
    justSentRef.current = false;
    if (result === "objectionable") restoreRejectedText(sending);
  }

  async function handleRetry(m: ChatMessage) {
    const result = await retryRoundMessage(m);
    if (result === "objectionable") restoreRejectedText(m.text);
  }

  // A failed message once the round is over: retry can't help, so say why
  // (discard is still offered, and the text stays visible to copy).
  const failedAfterEndLabel = status === "cancelled" ? t("roundChat.notSentCancelled") : t("roundChat.notSentEnded");

  return (
    // Opted out of useDismissKeyboardOnDrag: while the composer is docked
    // the message list is the one thing that still scrolls, so dragging it
    // to read back keeps the keyboard (and the docked composer) up.
    // Also opted out of useRevealFocusedFieldAboveKeyboard: the composer
    // docks itself above the keyboard.
    <div data-keyboard-drag-dismiss="off" data-keyboard-reveal="off" className="flex flex-col rounded-2xl border border-slate-100 bg-white">
      {/* A leading mt-auto spacer bottom-anchors a short thread against the
          composer (DirectMessageThread's fix). Not justify-end on the
          scroller: that makes the browser report scrollHeight equal to
          clientHeight once the list overflows, so older messages couldn't
          be scrolled to and every scrollTop pin was a no-op (measured
          headless: 17 messages, scrollHeight 384 = clientHeight). */}
      <div
        ref={listRef}
        className={`flex flex-col gap-3 overflow-y-auto px-4 py-4 ${layout === "page" ? "" : "max-h-96"}`}
        // Page: fill the screen between the thread header and the bottom
        // nav (18rem ~ top bar + header + composer + nav), so the composer
        // sits low like a chat app. A fixed height, not one that follows the
        // keyboard: the composer docks over the keyboard on its own.
        style={layout === "page" ? { height: PAGE_LIST_HEIGHT, minHeight: "16rem" } : undefined}
      >
        <div className="mt-auto" />
        {messages.length === 0 && <p className="text-center text-sm text-slate-400">{t("chat.noMessagesYet")}</p>}
        {messages.map((m) => {
          if (m.system) {
            return (
              <p key={m.id} className="text-center text-xs text-slate-400">
                {m.text}
              </p>
            );
          }
          const sender = getGolfer(m.senderId);
          const isMe = m.senderId === currentUser.id;
          const failed = m.delivery === "failed";
          return (
            <div key={m.clientId ?? m.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              {sender && <Avatar golfer={sender} size="xs" showVerified={false} />}
              <div className={`flex max-w-[75%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                {!isMe && <span className="mb-0.5 text-[11px] font-medium text-slate-400">{sender?.name}</span>}
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm transition-opacity duration-200 ${
                    failed
                      ? "rounded-br-sm border border-rose-300 bg-rose-50 text-slate-800"
                      : isMe
                        ? "rounded-br-sm bg-fairway-600 text-white"
                        : "rounded-bl-sm bg-slate-100 text-slate-800"
                  } ${m.delivery === "sending" ? "opacity-60" : ""}`}
                >
                  {m.text}
                  {m.delivery === "sending" && <span className="sr-only"> ({t("roundChat.sending")})</span>}
                </div>
                {failed && m.clientId && (
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-semibold">
                    {readOnly ? (
                      <span className="flex items-center gap-1 text-rose-600">
                        <AlertCircle size={12} aria-hidden="true" /> {failedAfterEndLabel}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRetry(m)}
                        aria-label={t("roundChat.retryLabel")}
                        className="flex items-center gap-1 rounded text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      >
                        <AlertCircle size={12} aria-hidden="true" /> {t("roundChat.notSentRetry")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => discardRoundMessage(m.clientId!)}
                      className="rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {t("roundChat.discard")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Holds the composer's place, plus the keyboard's height: near the
          bottom of the page there's otherwise no room to scroll the latest
          content up above the docked bar (it's hidden under the keyboard). */}
      {composerDocked && <div aria-hidden="true" style={{ height: composerHeight + keyboardHeight }} />}
      {readOnly ? (
        <p role="status" className="flex items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-3 text-center text-xs font-medium text-slate-500">
          <Lock size={13} aria-hidden="true" className="shrink-0" /> {readOnlyNote}
        </p>
      ) : (
      <div
        ref={composerRef}
        className={
          composerDocked
            ? "fixed inset-x-0 z-40 bg-[#faf9f6] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
            : undefined
        }
        style={composerDocked ? { bottom: `${keyboardHeight}px` } : undefined}
      >
        <ChatComposer value={text} onChange={updateText} onSend={handleSend} placeholder={t("chat.messagePlaceholder")} />
      </div>
      )}
    </div>
  );
}
