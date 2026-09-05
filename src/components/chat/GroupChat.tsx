import { useEffect, useRef, useState } from "react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import { ChatComposer } from "./ChatComposer";
import { groupChatDraftKey, loadChatDraft, saveChatDraft } from "../../lib/chatDraft";
import { useLocale } from "../../i18n/LocaleContext";

export function GroupChat({ callId }: { callId: string }) {
  const { currentUser, getGolfer, messagesForCall, sendMessage } = useData();
  const { t } = useLocale();
  const [text, setText] = useState(() => loadChatDraft(groupChatDraftKey(callId)));
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = messagesForCall(callId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
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

  function handleSend() {
    if (!text.trim()) return;
    sendMessage(callId, text);
    updateText("");
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white">
      {/* justify-end bottom-anchors a short thread against the composer
          (same fix as DirectMessageThread) instead of stacking from the top
          and leaving the gap below instead. */}
      <div className="flex max-h-96 flex-col justify-end gap-3 overflow-y-auto px-4 py-4">
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
      <ChatComposer value={text} onChange={updateText} onSend={handleSend} placeholder={t("chat.messagePlaceholder")} />
    </div>
  );
}
