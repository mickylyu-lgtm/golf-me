import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { ChatComposer } from "./ChatComposer";
import { groupChatDraftKey, loadChatDraft, saveChatDraft } from "../../lib/chatDraft";
import { useLocale } from "../../i18n/LocaleContext";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";

export function GroupChat({ callId }: { callId: string }) {
  const { currentUser, getGolfer, messagesForCall, sendMessage } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [text, setText] = useState(() => loadChatDraft(groupChatDraftKey(callId)));
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = messagesForCall(callId);

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
  const composerDocked = keyboardHeight > 0;
  const composerRef = useRef<HTMLDivElement>(null);
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
  function rememberScrollBeforeKeyboard() {
    if (!composerDocked) scrollYBeforeKeyboardRef.current = window.scrollY;
  }

  // Layout effect, not a passive one: the scroll lock and the restore to the
  // saved position must land before the docked layout paints, or the
  // iOS-panned page could flash for a frame before snapping back.
  useLayoutEffect(() => {
    if (!composerDocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const saved = scrollYBeforeKeyboardRef.current;
    if (saved !== null && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      if (restoreTo !== null) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
  }, [composerDocked]);

  useEffect(() => {
    // While docked, scrollIntoView would also scroll the (locked) page and
    // undo the "page doesn't jump" guarantee on every sent/received
    // message -- scroll only the message list itself then. Undocked
    // behavior is unchanged.
    if (composerDocked) {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
    // composerDocked deliberately not a dependency: this follows new
    // messages, not keyboard open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleSend() {
    const sending = text;
    if (!sending.trim()) return;
    // Clear right away so sending feels instant; if it fails, say so and put
    // the text back (unless the golfer already started typing something new)
    // so it can be retried instead of silently vanishing.
    updateText("");
    const result = await sendMessage(callId, sending);
    if (result !== "sent") {
      showToast(result === "objectionable" ? t("moderation.objectionableContent") : t("chat.sendFailedToast"), "warning");
      setText((current) => {
        if (current.trim()) return current;
        saveChatDraft(groupChatDraftKey(callId), sending);
        return sending;
      });
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white">
      {/* justify-end bottom-anchors a short thread against the composer
          (same fix as DirectMessageThread) instead of stacking from the top
          and leaving the gap below instead. */}
      <div ref={listRef} className="flex max-h-96 flex-col justify-end gap-3 overflow-y-auto px-4 py-4">
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
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              {sender && <Avatar golfer={sender} size="xs" showVerified={false} />}
              <div className={`flex max-w-[75%] flex-col ${isMe ? "items-end" : "items-start"}`}>
                {!isMe && <span className="mb-0.5 text-[11px] font-medium text-slate-400">{sender?.name}</span>}
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm ${
                    isMe ? "rounded-br-sm bg-fairway-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {composerDocked && <div aria-hidden="true" style={{ height: composerHeight }} />}
      <div
        ref={composerRef}
        onFocusCapture={rememberScrollBeforeKeyboard}
        className={
          composerDocked
            ? "fixed inset-x-0 z-40 bg-[#faf9f6] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
            : undefined
        }
        style={composerDocked ? { bottom: `${keyboardHeight}px` } : undefined}
      >
        <ChatComposer value={text} onChange={updateText} onSend={handleSend} placeholder={t("chat.messagePlaceholder")} />
      </div>
    </div>
  );
}
