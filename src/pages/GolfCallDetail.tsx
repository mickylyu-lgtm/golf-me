import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Car,
  Check,
  Footprints,
  Lock,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { GroupChat } from "../components/chat/GroupChat";
import { ReviewModal } from "../components/review/ReviewModal";
import { ReportModal } from "../components/trust/ReportModal";
import { TrustBadgeRow } from "../components/golfer/TrustBadges";
import { MatchReasons } from "../components/golfer/MatchReasons";
import { ConfirmJoinModal } from "../components/golfcall/ConfirmJoinModal";
import { TeeTimeTrustBadge } from "../components/golfcall/TeeTimeTrustBadge";
import { BookingProofExplainer } from "../components/golfcall/BookingProofExplainer";
import { BookingProofHostControls } from "../components/golfcall/BookingProofHostControls";
import { EditTeeTimeModal } from "../components/golfcall/EditTeeTimeModal";
import { formatDate, formatMoney } from "../lib/format";
import { skillLabel, vibeLabel, walkOrCartLabel } from "../lib/enumLabels";
import { VIBE_TONE } from "../lib/theme";
import { computeCallCompatibility } from "../lib/compatibility";
import { matchTier, callMatchReasons } from "../lib/matchReasons";
import { track } from "../lib/analytics";
import { enrichRealCourse } from "../lib/realCourseSearch";

export function GolfCallDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    getGolfCall,
    getGolfer,
    joinGolfCall,
    cancelJoinRequest,
    leaveGolfCall,
    cancelGolfCall,
    simulateCallCompletion,
    completeGolfCall,
    approveRequest,
    declineRequest,
    hasReviewed,
  } = useData();
  const { isDemo } = useAuth();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const [joining, setJoining] = useState(false);

  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [proofExplainerOpen, setProofExplainerOpen] = useState(false);
  const [editTeeTimeOpen, setEditTeeTimeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const call = id ? getGolfCall(id) : undefined;

  useEffect(() => {
    if (call) track("first_round_viewed", { callId: call.id });
  }, [call?.id]);

  // Best-effort, fire-and-forget: on-demand GolfCourseAPI enrichment for the
  // real course this round is at. course-enrich itself no-ops instantly if
  // this course has already been checked, so it's safe to fire on every
  // view rather than tracking "have I already called this" client-side too.
  useEffect(() => {
    if (!isDemo && call?.courseId) enrichRealCourse(call.courseId);
  }, [isDemo, call?.courseId]);

  if (!call) {
    return (
      <div className="py-12 text-center text-slate-500">
        {t("golfCallDetail.notFound")}
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            {t("golfCallDetail.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  const host = getGolfer(call.hostId);
  const isHost = call.hostId === currentUser.id;
  const isJoined = call.joinedGolferIds.includes(currentUser.id);
  const isPending = call.pendingRequestIds.includes(currentUser.id);
  const openSpots = call.totalSpots - call.joinedGolferIds.length;
  const isFull = call.status === "full" || openSpots <= 0;
  const isCompleted = call.status === "completed";
  const isCancelled = call.status === "cancelled";
  const isUrgent = !isFull && !isCompleted && !isCancelled && openSpots === 1;
  const chatUnlocked = isHost || isJoined;
  const breakdown = !isHost ? computeCallCompatibility(currentUser, call) : null;
  const tier = breakdown ? matchTier(breakdown.overall) : null;
  const reasons = breakdown ? callMatchReasons(call, breakdown, locale, t) : [];
  const canJoin = !isHost && !isJoined && !isPending && !isFull;

  async function handleJoin() {
    if (joining) return;
    setJoining(true);
    try {
      await joinGolfCall(call!.id);
      showToast(
        call!.joinMode === "instant" ? t("golfCallDetail.joinedInstantToast", { date: formatDate(call!.dateISO, locale, t) }) : t("golfCallDetail.requestSentToast"),
        "success",
      );
    } catch (err) {
      // Real, atomic failure — e.g. someone else took the last spot first.
      // Never silently no-ops; the golfer sees exactly why it didn't work.
      showToast(err instanceof Error ? err.message : t("golfCallDetail.joinError"), "warning");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft size={16} /> {t("golfCallDetail.back")}
        </button>
        {!isDemo && !isHost && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("golfCallDetail.moreOptions")}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <ShieldAlert size={13} /> {t("golfCallDetail.reportRound")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {isCancelled && <Badge tone="rose">{t("golfCallDetail.statusCancelled")}</Badge>}
          {isCompleted && <Badge tone="slate">{t("golfCallDetail.statusCompleted")}</Badge>}
          {!isCompleted && !isCancelled && (
            <Badge
              tone={isFull ? "slate" : isUrgent ? "sun" : "fairway"}
              className={isUrgent ? "animate-pulse font-bold tracking-wide uppercase" : ""}
            >
              {isFull ? t("golfCallDetail.full") : isUrgent ? t("golfCallDetail.oneSpotLeft") : t("golfCallDetail.spotsOpen", { count: openSpots, plural: openSpots === 1 ? "" : "s" })}
            </Badge>
          )}
          <Badge tone="outline">{call.joinMode === "instant" ? t("golfCallDetail.instantJoin") : t("golfCallDetail.requestToJoinBadge")}</Badge>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">{call.course}</h1>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          <MapPin size={13} /> {t("golfCallCard.miAway", { miles: call.distanceMiles.toFixed(0) })} · {call.areaLabel}
        </p>
      </div>

      {tier && (
        <div className="rounded-2xl bg-fairway-50/70 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {tier.label} for you
          </p>
          <MatchReasons reasons={reasons} className="mt-1.5" />
          {/* A trust signal, never one of the compatibility factors above —
              always appended after them, not competing for one of their
              slots (see callMatchReasons/pickReasons, which never sees or
              scores this). */}
          {call.teeTimeSource === "user_verified" && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fairway-700">
              <span aria-hidden className="font-bold">✓</span> {t("golfCallDetail.bookingProofMatchReason")}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <CalendarDays size={12} /> {t("golfCallDetail.when")}
          </p>
          <p className="mt-1 font-bold text-slate-800">{formatDate(call.dateISO, locale, t)}</p>
          <p className="text-sm text-slate-500">{call.timeLabel}</p>
          {/* Cancelled/completed rounds keep their verification metadata in
              the DB (never deleted) but never show an active badge — a
              tee time that's over or off is never still "usable." */}
          {!isDemo && !isCancelled && !isCompleted && call.teeTimeSource === "user_verified" ? (
            <TeeTimeTrustBadge source={call.teeTimeSource} onClick={() => setProofExplainerOpen(true)} className="mt-1.5" />
          ) : (
            !isDemo && <p className="mt-1 text-[11px] leading-tight text-slate-400">{t("golfCallDetail.teeTimeDisclaimer")}</p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wallet size={12} /> {t("golfCallDetail.estimatedPrice")}
          </p>
          <p className="mt-1 font-bold text-slate-800">
            {t("golfCallDetail.pricePerPerson", { price: formatMoney(call.estimatedPricePerPerson) })}
          </p>
          <p className="text-sm text-slate-500">{t("golfCallDetail.payAtCourse")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="outline">{skillLabel(call.skillLevel, t)}</Badge>
        <Badge tone={VIBE_TONE[call.vibe]}>{vibeLabel(call.vibe, t)}</Badge>
        <Badge tone="outline" icon={call.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />}>
          {walkOrCartLabel(call.walkOrCart, t)}
        </Badge>
      </div>

      {!isDemo && isHost && !isCompleted && !isCancelled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={<Pencil size={13} />} onClick={() => setEditTeeTimeOpen(true)}>
            {t("golfCallDetail.editTeeTime")}
          </Button>
          <BookingProofHostControls golfCallId={call.id} />
        </div>
      )}

      {call.notes && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golfCallDetail.notesFromHost")}</p>
          <p className="text-sm text-slate-600">{call.notes}</p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <Users size={15} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">
            {t("golfCallDetail.foursome", { joined: call.joinedGolferIds.length, total: call.totalSpots })}
          </h2>
        </div>
        <div className="flex flex-col gap-2">
          {call.joinedGolferIds.map((gid) => {
            const g = getGolfer(gid);
            if (!g) return null;
            return (
              <button
                key={gid}
                onClick={() => (g.id === currentUser.id ? navigate("/profile") : navigate(`/golfer/${g.id}`))}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-fairway-200 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <Avatar golfer={g} size="sm" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {g.name} {g.id === currentUser.id && <span className="font-normal text-slate-400">{t("golfCallDetail.you")}</span>}
                    {g.id === call.hostId && <span className="ml-1.5 text-xs font-medium text-sun-600">{t("golfCallDetail.hostTag")}</span>}
                  </p>
                  <p className="text-xs text-slate-500">{g.handicap !== null ? t("golfCallDetail.handicapValue", { handicap: g.handicap }) : t("golfCallDetail.noHandicapYet")}</p>
                  <TrustBadgeRow golfer={g} className="mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {isHost && call.pendingRequestIds.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-bold text-slate-800">{t("golfCallDetail.requestsToJoin")}</h2>
          <div className="flex flex-col gap-2">
            {call.pendingRequestIds.map((gid) => {
              const g = getGolfer(gid);
              if (!g) return null;
              return (
                <div key={gid} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                  <Avatar golfer={g} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                    <TrustBadgeRow golfer={g} />
                  </div>
                  <button
                    onClick={() => approveRequest(call.id, gid)}
                    aria-label={`Approve ${g.name}`}
                    className="rounded-full bg-fairway-600 p-1.5 text-white transition-all duration-200 ease-out hover:-translate-y-px hover:bg-fairway-700 active:translate-y-0 active:bg-fairway-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => declineRequest(call.id, gid)}
                    aria-label={`Decline ${g.name}`}
                    className="rounded-full bg-slate-100 p-1.5 text-slate-500 transition-all duration-200 ease-out hover:-translate-y-px hover:bg-slate-200 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isCompleted && !isCancelled && (
        <div className="sticky bottom-20 z-10 sm:bottom-0">
          {isHost ? (
            <Button variant="danger" fullWidth onClick={() => setCancelConfirmOpen(true)}>
              {t("golfCallDetail.cancelGolfCall")}
            </Button>
          ) : isJoined ? (
            <Button variant="outline" fullWidth onClick={() => setLeaveConfirmOpen(true)}>
              {t("golfCallDetail.leaveRound")}
            </Button>
          ) : isPending ? (
            <Button variant="outline" fullWidth onClick={() => cancelJoinRequest(call.id)}>
              {t("golfCallDetail.cancelRequest")}
            </Button>
          ) : isFull ? (
            <Button disabled fullWidth>
              {t("golfCallDetail.foursomeFull")}
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={() => setJoinConfirmOpen(true)}>
              {call.joinMode === "instant" ? t("golfCallDetail.joinRound") : t("golfCallDetail.requestToJoinButton")}
            </Button>
          )}
        </div>
      )}

      {/* Demo: instant, any-participant prototype shortcut, unchanged. */}
      {isDemo && !isCompleted && !isCancelled && (isHost || isJoined) && (
        <button
          onClick={() => {
            simulateCallCompletion(call.id);
            showToast(t("golfCallDetail.markCompletedToast"), "info");
          }}
          className="self-center text-xs font-medium text-slate-400 underline-offset-2 transition-colors duration-200 hover:text-slate-600 hover:underline"
        >
          🧪 Simulate round completion (prototype)
        </button>
      )}

      {/* Real: host-only, manual — "keep the beta logic simple" means no
          scheduled job watching tee times, the host decides when it's over. */}
      {!isDemo && isHost && !isCompleted && !isCancelled && (
        <Button
          variant="outline"
          fullWidth
          onClick={async () => {
            try {
              await completeGolfCall(call.id);
              showToast(t("golfCallDetail.markCompletedToast"), "success");
            } catch (err) {
              showToast(err instanceof Error ? err.message : t("golfCallDetail.markCompletedError"), "warning");
            }
          }}
        >
          {t("golfCallDetail.markCompleted")}
        </Button>
      )}

      {isCompleted && isJoined && (
        <div>
          <h2 className="mb-2 text-sm font-bold text-slate-800">{t("golfCallDetail.reviewYourGroup")}</h2>
          <div className="flex flex-col gap-2">
            {call.joinedGolferIds
              .filter((gid) => gid !== currentUser.id)
              .map((gid) => {
                const g = getGolfer(gid);
                if (!g) return null;
                const reviewed = hasReviewed(call.id, gid);
                return (
                  <div key={gid} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                    <Avatar golfer={g} size="sm" />
                    <p className="flex-1 text-sm font-semibold text-slate-800">{g.name}</p>
                    {reviewed ? (
                      <Badge tone="fairway">{t("golfCallDetail.reviewed")}</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setReviewingId(gid)}>
                        {t("golfCallDetail.leaveReview")}
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <MessageCircle size={15} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">{t("golfCallDetail.groupChat")}</h2>
        </div>
        {chatUnlocked ? (
          <GroupChat callId={call.id} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-8 text-center">
            <Lock size={18} className="text-slate-400" />
            <p className="text-sm text-slate-500">{t("golfCallDetail.chatLocked")}</p>
          </div>
        )}
      </div>

      {host && !isHost && (
        <p className="text-center text-xs text-slate-400">{t("golfCallDetail.hostedBy", { name: host.name })}</p>
      )}

      {leaveConfirmOpen && (
        <ConfirmDialog
          title={t("golfCallDetail.leaveConfirmTitle")}
          message={t("golfCallDetail.leaveConfirmMessage")}
          confirmLabel={t("golfCallDetail.leaveRound")}
          danger
          onConfirm={async () => {
            try {
              await leaveGolfCall(call.id);
              showToast(t("golfCallDetail.leftRoundToast"), "info");
            } catch (err) {
              showToast(err instanceof Error ? err.message : t("golfCallDetail.leaveError"), "warning");
            } finally {
              setLeaveConfirmOpen(false);
            }
          }}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      )}
      {cancelConfirmOpen && (
        <ConfirmDialog
          title={t("golfCallDetail.cancelConfirmTitle")}
          message={t("golfCallDetail.cancelConfirmMessage")}
          confirmLabel={t("golfCallDetail.cancelGolfCall")}
          danger
          onConfirm={async () => {
            try {
              await cancelGolfCall(call.id);
              showToast(t("golfCallDetail.cancelledToast"), "info");
            } catch (err) {
              showToast(err instanceof Error ? err.message : t("golfCallDetail.cancelError"), "warning");
            } finally {
              setCancelConfirmOpen(false);
            }
          }}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      )}
      {joinConfirmOpen && canJoin && (
        <ConfirmJoinModal
          call={call}
          onClose={() => setJoinConfirmOpen(false)}
          onConfirm={() => {
            setJoinConfirmOpen(false);
            handleJoin();
          }}
        />
      )}
      {reviewingId &&
        (() => {
          const reviewee = getGolfer(reviewingId);
          if (!reviewee) return null;
          return <ReviewModal callId={call.id} reviewee={reviewee} onClose={() => setReviewingId(null)} />;
        })()}
      {proofExplainerOpen && <BookingProofExplainer call={call} onClose={() => setProofExplainerOpen(false)} />}
      {editTeeTimeOpen && <EditTeeTimeModal call={call} onClose={() => setEditTeeTimeOpen(false)} />}
      {reportOpen && host && (
        <ReportModal reportedId={host.id} reportedName={host.name} context="round" golfCallId={call.id} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}
