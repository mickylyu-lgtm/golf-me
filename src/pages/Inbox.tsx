import { useNavigate } from "react-router-dom";
import { ArrowLeft, MessageCircle, ShieldCheck } from "lucide-react";
import { useData } from "../context/DataContext";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { formatRelativeTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

export function Inbox() {
  const { dmConversations } = useData();
  const navigate = useNavigate();
  const { t, locale } = useLocale();

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500">Direct conversations with golfers you follow or have played with.</p>
      </div>

      {dmConversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title="No conversations yet."
          description="Follow a golfer, join their Golf Call, or play a round together to start messaging."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {dmConversations.map((c) => (
            <button
              key={c.conversationId}
              onClick={() => navigate(`/messages/${c.otherGolfer.id}`)}
              className={`flex w-full items-center gap-3 p-3.5 text-left ${CLICKABLE_CARD_CLASS}`}
            >
              <Avatar golfer={c.otherGolfer} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                  <span className="truncate">{c.otherGolfer.name}</span>
                  {c.otherGolfer.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-600" />}
                </p>
                <p className={`truncate text-xs ${c.unread ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                  {c.lastMessage.senderId === c.otherGolfer.id ? "" : "You: "}
                  {c.lastMessage.text}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[11px] text-slate-400">{formatRelativeTime(c.lastMessage.createdAt, locale, t)}</span>
                {c.unread && <span className="h-2 w-2 rounded-full bg-fairway-600" aria-label="Unread" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
