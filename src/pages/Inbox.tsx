import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Flag, MessageCircle, Search, Share2, ShieldCheck, Users } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useRealSocial } from "../context/RealSocialContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadErrorState, StaleDataNotice } from "../components/ui/LoadStates";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { listView } from "../lib/loadStatus";
import { findTabPath } from "../lib/findTab";
import { useShareActions } from "../lib/useShareActions";
import { CARD_PRESS_CLASS, CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";
import { FounderBadge } from "../components/golfer/TrustBadges";
import { formatDate, formatRelativeTime } from "../lib/format";
import { firstName } from "../lib/greeting";
import { isFounder } from "../lib/founder";
import { isUpcomingRound, nextUpcomingRound, orderRoundChats } from "../lib/golfCall";
import { useLocale } from "../i18n/LocaleContext";
import type { GolfCall } from "../types";
import { messagePreviewText } from "../lib/chatImages";

type InboxTab = "direct" | "rounds";
const TAB_STORAGE_KEY = "golfme.chatInboxTab";

// Per-viewer convenience only: coming back from a round thread lands on the
// Rounds tab again. Storage can be unavailable; Direct is the default.
function loadTab(): InboxTab {
  try {
    return sessionStorage.getItem(TAB_STORAGE_KEY) === "rounds" ? "rounds" : "direct";
  } catch {
    return "direct";
  }
}
function saveTab(tab: InboxTab) {
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

// Chat — the real DM inbox, now a first-class root tab instead of a row
// buried on the Me/Profile page. dmConversations already resolves "every
// conversation the authenticated user is a participant in" (see
// RealSocialContext), so this page never needs to already know who the
// other golfer is — it's the canonical entry point for that.
//
// Round group chats sit behind a Direct | Rounds switch rather than a
// second section below the DMs: on a 375px screen a Rounds section would
// either push the DM list down or get buried under it, and the two lists
// have different load states (RealSocial vs RealRounds). The next-round
// card stays pinned above both.
export function Inbox() {
  const { dmConversations, golfCalls, currentUser } = useData();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [tab, setTab] = useState<InboxTab>(loadTab);
  const nextRound = useMemo(() => nextUpcomingRound(golfCalls, currentUser.id), [golfCalls, currentUser.id]);
  const dmUnread = dmConversations.some((c) => c.unread);

  function selectTab(next: InboxTab) {
    setTab(next);
    saveTab(next);
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <h1 className="text-xl font-bold text-slate-900">{t("chatInbox.title")}</h1>

      {nextRound && (
        <section aria-label={t("chatInbox.nextRound")} className="flex flex-col gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/60 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-fairway-700">{t("chatInbox.nextRound")}</p>
            <p className="mt-0.5 truncate font-bold text-slate-900">{nextRound.course}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <CalendarDays size={12} aria-hidden="true" /> {formatDate(nextRound.dateISO, locale, t)} · {nextRound.timeLabel}
              </span>
              <span className="flex items-center gap-1">
                <Users size={12} aria-hidden="true" />
                {t("chatInbox.nextRoundPlayers", { joined: nextRound.joinedGolferIds.length, total: nextRound.totalSpots })}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<MessageCircle size={14} />} onClick={() => navigate(`/messages/round/${nextRound.id}`)}>
              {t("chatInbox.openChat")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/golf-calls/${nextRound.id}`)}>
              {t("chatInbox.viewRound")}
            </Button>
          </div>
        </section>
      )}

      <div role="tablist" aria-label={t("chatInbox.tabsLabel")} className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
        {(["direct", "rounds"] as const).map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => selectTab(key)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {key === "direct" ? t("chatInbox.tabDirect") : t("chatInbox.tabRounds")}
              {key === "direct" && dmUnread && !active && <span className="h-1.5 w-1.5 rounded-full bg-fairway-500" aria-label="Unread" />}
            </button>
          );
        })}
      </div>

      {tab === "direct" ? <DirectList /> : <RoundsList />}
    </div>
  );
}

function DirectList() {
  const { dmConversations, typingConversationIds } = useData();
  const { isDemo } = useAuth();
  const social = useRealSocial();
  // A failed first load must not read as "no conversations yet".
  const view = listView({ count: dmConversations.length, isDemo, hasLoaded: social.hasLoaded, loadError: social.loadError, isLoading: social.isLoading });
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const { shareApp } = useShareActions();
  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? dmConversations.filter((c) => c.otherGolfer.name.toLowerCase().includes(trimmedQuery))
    : dmConversations;

  return (
    <>
      {dmConversations.length > 0 && (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chatInbox.searchPlaceholder")}
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3.5 text-sm outline-none transition focus:border-fairway-400 focus:ring-1 focus:ring-fairway-400"
          />
        </div>
      )}

      {social.refreshFailed && <StaleDataNotice onRetry={social.retry} />}

      {view === "loading" ? (
        <GolfMeLoader className="py-12" />
      ) : view === "error" ? (
        <LoadErrorState onRetry={social.retry} />
      ) : dmConversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title={t("chatInbox.emptyTitle")}
          description={t("chatInbox.emptyDescription")}
          action={
            // The Golfers tab works for real and demo accounts alike (the
            // name search at /profile/following/find sends demo straight back).
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => navigate(findTabPath("golfers"))}>
                {t("findFriends.entryPoint")}
              </Button>
              <Button size="sm" variant="outline" icon={<Share2 size={14} />} onClick={() => void shareApp()}>
                {t("common.inviteFriend")}
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="px-1 text-sm text-slate-500">{t("chatInbox.noSearchResults")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((c) => (
            <button
              key={c.conversationId}
              onClick={() => navigate(`/messages/${c.otherGolfer.id}`, { state: { fromInbox: true } })}
              data-haptic="tap"
              className={`flex w-full items-center gap-3 p-3 text-left ${CLICKABLE_CARD_CLASS} ${CARD_PRESS_CLASS}`}
            >
              <Avatar golfer={c.otherGolfer} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                  <span className="truncate">{c.otherGolfer.name}</span>
                  {isFounder(c.otherGolfer.id) ? (
                    <FounderBadge />
                  ) : (
                    c.otherGolfer.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-500" />
                  )}
                </p>
                <p
                  className={`truncate text-xs ${
                    typingConversationIds.has(c.conversationId) ? "font-semibold text-fairway-600" : c.unread ? "font-semibold text-slate-700" : "text-slate-500"
                  }`}
                >
                  {typingConversationIds.has(c.conversationId) ? (
                    t("chatInbox.typingPreview", { name: firstName(c.otherGolfer.name) })
                  ) : (
                    <>
                      {c.lastMessage.senderId === c.otherGolfer.id ? "" : t("chatInbox.youPrefix")}
                      {c.lastMessage.unsentAt ? <span className="italic">{t("chat.messageUnsent")}</span> : messagePreviewText(c.lastMessage, t("chat.photo"), t("chat.voice"))}
                    </>
                  )}
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
    </>
  );
}

// Every round the golfer hosts or is in (a round they left drops out:
// they're no longer in joinedGolferIds). Upcoming first by tee time, then
// past / ended ones. No unread counts yet.
function RoundsList() {
  const { golfCalls, currentUser } = useData();
  const { isDemo } = useAuth();
  const rounds = useRealRounds();
  const { t } = useLocale();
  const navigate = useNavigate();
  const ordered = useMemo(() => orderRoundChats(golfCalls, currentUser.id), [golfCalls, currentUser.id]);
  const view = listView({ count: ordered.length, isDemo, hasLoaded: rounds.hasLoaded, loadError: rounds.loadError, isLoading: rounds.isLoading });
  const now = new Date();
  const firstPastIndex = ordered.findIndex((c) => !isUpcomingRound(c, now));

  return (
    <>
      {rounds.refreshFailed && <StaleDataNotice onRetry={rounds.retry} />}
      {view === "loading" ? (
        <GolfMeLoader className="py-12" />
      ) : view === "error" ? (
        <LoadErrorState onRetry={rounds.retry} />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<Flag size={20} />}
          title={t("chatInbox.roundsEmptyTitle")}
          description={t("chatInbox.roundsEmptyDescription")}
          action={
            <Button size="sm" onClick={() => navigate(findTabPath("rounds"))}>
              {t("home.findRound")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {ordered.map((c, i) => (
            <div key={c.id} className="contents">
              {i === firstPastIndex && i > 0 && (
                <h2 className="mt-3 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t("myGolf.past")}</h2>
              )}
              <RoundChatRow call={c} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RoundChatRow({ call }: { call: GolfCall }) {
  const { messagesForCall, getGolfer, currentUser } = useData();
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const messages = messagesForCall(call.id);
  const last = messages[messages.length - 1];
  const sender = last && !last.system ? (last.senderId === currentUser.id ? null : getGolfer(last.senderId)) : null;
  const prefix = !last || last.system ? "" : last.senderId === currentUser.id ? t("chatInbox.youPrefix") : sender ? t("chatInbox.roundSenderPrefix", { name: firstName(sender.name) }) : "";
  const ended = call.status === "completed" || call.status === "cancelled";

  return (
    <button
      onClick={() => navigate(`/messages/round/${call.id}`)}
      data-haptic="tap"
      className={`flex w-full items-center gap-3 p-3 text-left ${CLICKABLE_CARD_CLASS} ${CARD_PRESS_CLASS}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ended ? "bg-slate-100 text-slate-400" : "bg-fairway-50 text-fairway-600"}`}
      >
        <Flag size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <span className="truncate">{call.course}</span>
          {ended && (
            <Badge tone={call.status === "cancelled" ? "rose" : "slate"}>{call.status === "cancelled" ? t("myGolf.cancelled") : t("myGolf.completed")}</Badge>
          )}
        </p>
        <p className="truncate text-[11px] font-medium text-fairway-700">
          {formatDate(call.dateISO, locale, t)} · {call.timeLabel}
        </p>
        <p className={`truncate text-xs ${last?.delivery === "failed" ? "text-rose-600" : "text-slate-500"}`}>
          {last ? (
            <>
              {prefix}
              {last.unsentAt ? <span className="italic">{t("chat.messageUnsent")}</span> : messagePreviewText(last, t("chat.photo"), t("chat.voice"))}
            </>
          ) : (
            t("chatInbox.roundNoMessages")
          )}
        </p>
      </div>
      {last && <span className="shrink-0 self-start text-[11px] text-slate-400">{formatRelativeTime(last.createdAt, locale, t)}</span>}
    </button>
  );
}
