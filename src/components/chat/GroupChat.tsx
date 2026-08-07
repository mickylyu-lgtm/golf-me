import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";

export function GroupChat({ callId }: { callId: string }) {
  const { currentUser, getGolfer, messagesForCall, sendMessage } = useData();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = messagesForCall(callId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function handleSend() {
    if (!text.trim()) return;
    sendMessage(callId, text);
    setText("");
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white">
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <p className="text-center text-sm text-slate-400">No messages yet — say hello to the group.</p>}
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
      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Message the group..."
          className="flex-1 rounded-full bg-slate-100 px-3.5 py-2 text-sm outline-none focus:bg-slate-50 focus:ring-2 focus:ring-fairway-100"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          aria-label="Send message"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-white transition disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
