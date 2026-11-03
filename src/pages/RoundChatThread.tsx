import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Lock, MessageCircle } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { useRealSocial } from "../context/RealSocialContext";
import { GroupChat } from "../components/chat/GroupChat";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { LoadErrorState } from "../components/ui/LoadStates";
import { Button } from "../components/ui/Button";
import { formatDate } from "../lib/format";
import { goBack } from "../lib/goBack";
import { canReadRoundChat, roundChatAccess } from "../lib/roundChat";
import type { RoundChatAccess } from "../lib/roundChat";
import { useLocale } from "../i18n/LocaleContext";

// /messages/round/:id -- a round's group chat as its own Chat-tab thread
// (the round page keeps its inline card too). Same access rule as the round
// page (lib/roundChat.ts): only the host and joined golfers see messages;
// anyone else -- never joined, left, blocked, or a round they can't see --
// gets a locked note, never an empty chat or another round's messages.
export function RoundChatThread() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, getGolfCall, hasLeftGolfCall, isBlockedEitherWay } = useData();
  const { isDemo } = useAuth();
  const { hasLoaded: roundsLoaded, loadError: roundsLoadError, isLoading: roundsLoading, retry: retryRounds } = useRealRounds();
  const { hasLoaded: socialLoaded } = useRealSocial();
  const { t, locale } = useLocale();

  const call = id ? getGolfCall(id) : undefined;
  const back = () => goBack(navigate, "/messages");

  // Same waits as GolfCallDetail: a cold open (push, refresh) shouldn't
  // flash "unavailable" before the rounds and the block list have loaded.
  const waitingForBlocks = !isDemo && !socialLoaded && call?.hostId !== currentUser.id;
  if ((!call && !roundsLoaded) || waitingForBlocks) return <GolfMeLoader className="py-12" />;
  if (!call && roundsLoadError) return roundsLoading ? <GolfMeLoader className="py-12" /> : <LoadErrorState onRetry={retryRounds} />;

  const access: RoundChatAccess = roundChatAccess({
    exists: Boolean(call),
    status: call?.status,
    isHost: call?.hostId === currentUser.id,
    isJoined: Boolean(call?.joinedGolferIds.includes(currentUser.id)),
    hasLeft: id ? hasLeftGolfCall(id) : false,
    blockedWithHost: call ? isBlockedEitherWay(call.hostId) : false,
  });

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex items-center gap-3">
        <button
          onClick={back}
          aria-label={t("common.back")}
          className="flex shrink-0 items-center gap-1.5 rounded-full p-1 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
        >
          <ArrowLeft size={18} />
        </button>
        {call && (
          <button
            onClick={() => navigate(`/golf-calls/${call.id}`)}
            aria-label={`${call.course} · ${t("chatInbox.viewRound")}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fairway-50 text-fairway-600">
              <MessageCircle size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-900">{call.course}</span>
              <span className="block truncate text-xs text-slate-500">
                {formatDate(call.dateISO, locale, t)} · {call.timeLabel}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-slate-300" />
          </button>
        )}
      </div>

      {call && canReadRoundChat(access) ? (
        <GroupChat callId={call.id} layout="page" />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-10 text-center">
          <Lock size={18} className="text-slate-400" />
          <p className="text-sm text-slate-500">
            {access === "left"
              ? t("roundChat.left")
              : access === "blocked"
                ? t("roundChat.blocked")
                : access === "locked"
                  ? t("golfCallDetail.chatLocked")
                  : t("roundChat.unavailable")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {call && access === "locked" && (
              <Button size="sm" onClick={() => navigate(`/golf-calls/${call.id}`)}>
                {t("chatInbox.viewRound")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate("/messages")}>
              {t("roundChat.backToChat")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
