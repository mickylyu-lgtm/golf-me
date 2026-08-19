import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Search, ShieldCheck } from "lucide-react";
import { useData } from "../context/DataContext";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { formatRelativeTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

// Chat — the real DM inbox, now a first-class root tab instead of a row
// buried on the Me/Profile page. dmConversations already resolves "every
// conversation the authenticated user is a participant in" (see
// RealSocialContext), so this page never needs to already know who the
// other golfer is — it's the canonical entry point for that.
export function Inbox() {
  const { dmConversations } = useData();
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? dmConversations.filter((c) => c.otherGolfer.name.toLowerCase().includes(trimmedQuery))
    : dmConversations;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <h1 className="text-xl font-bold text-slate-900">{t("chatInbox.title")}</h1>

      {dmConversations.length > 0 && (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chatInbox.searchPlaceholder")}
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3.5 text-sm outline-none transition focus:border-fairway-400"
          />
        </div>
      )}

      {dmConversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title={t("chatInbox.emptyTitle")}
          description={t("chatInbox.emptyDescription")}
          action={
            <Button size="sm" onClick={() => navigate("/profile/following/find")}>
              {t("findFriends.entryPoint")}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="px-1 text-sm text-slate-500">{t("chatInbox.noSearchResults")}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((c) => (
            <button
              key={c.conversationId}
              onClick={() => navigate(`/messages/${c.otherGolfer.id}`)}
              className={`flex w-full items-center gap-3 p-3.5 text-left ${CLICKABLE_CARD_CLASS}`}
            >
              <Avatar golfer={c.otherGolfer} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                  <span className="truncate">{c.otherGolfer.name}</span>
                  {c.otherGolfer.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-500" />}
                </p>
                <p className={`truncate text-xs ${c.unread ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                  {c.lastMessage.senderId === c.otherGolfer.id ? "" : t("chatInbox.youPrefix")}
                  {c.lastMessage.text}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[11px] text-slate-400">{formatRelativeTime(c.lastMessage.createdAt, locale, t)}</span>
                {c.unread && <span className="h-2 w-2 rounded-full bg-fairway-500" aria-label="Unread" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
