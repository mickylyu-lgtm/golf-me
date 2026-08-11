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
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { GroupChat } from "../components/chat/GroupChat";
import { ReviewModal } from "../components/review/ReviewModal";
import { TrustBadgeRow } from "../components/golfer/TrustBadges";
import { MatchReasons } from "../components/golfer/MatchReasons";
import { ConfirmJoinModal } from "../components/golfcall/ConfirmJoinModal";
import { formatDate, formatMoney } from "../lib/format";
import { VIBE_TONE } from "../lib/theme";
import { computeCallCompatibility } from "../lib/compatibility";
import { matchTier, callMatchReasons } from "../lib/matchReasons";
import { track } from "../lib/analytics";

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
    approveRequest,
    declineRequest,
    hasReviewed,
  } = useData();
  const { showToast } = useToast();

  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);

  const call = id ? getGolfCall(id) : undefined;

  useEffect(() => {
    if (call) track("first_round_viewed", { callId: call.id });
  }, [call?.id]);

  if (!call) {
    return (
      <div className="py-12 text-center text-slate-500">
        Golf Call not found.
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
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
  const reasons = breakdown ? callMatchReasons(call, breakdown) : [];
  const canJoin = !isHost && !isJoined && !isPending && !isFull;

  function handleJoin() {
    joinGolfCall(call!.id);
    showToast(
      call!.joinMode === "instant" ? `You're playing ${formatDate(call!.dateISO)}. ⛳` : "Request sent to the host.",
      "success",
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {isCancelled && <Badge tone="rose">Cancelled</Badge>}
          {isCompleted && <Badge tone="slate">Completed</Badge>}
          {!isCompleted && !isCancelled && (
            <Badge
              tone={isFull ? "slate" : isUrgent ? "sun" : "fairway"}
              className={isUrgent ? "animate-pulse font-bold tracking-wide uppercase" : ""}
            >
              {isFull ? "Full" : isUrgent ? "1 Spot Left" : `${openSpots} spot${openSpots === 1 ? "" : "s"} open`}
            </Badge>
          )}
          <Badge tone="outline">{call.joinMode === "instant" ? "Instant join" : "Request to join"}</Badge>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">{call.course}</h1>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          <MapPin size={13} /> {call.distanceMiles.toFixed(0)} mi away · {call.areaLabel}
        </p>
      </div>

      {tier && (
        <div className="rounded-2xl bg-fairway-50/70 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {tier.label} for you
          </p>
          <MatchReasons reasons={reasons} className="mt-1.5" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <CalendarDays size={12} /> When
          </p>
          <p className="mt-1 font-bold text-slate-800">{formatDate(call.dateISO)}</p>
          <p className="text-sm text-slate-500">{call.timeLabel}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wallet size={12} /> Estimated price
          </p>
          <p className="mt-1 font-bold text-slate-800">{formatMoney(call.estimatedPricePerPerson)}/person</p>
          <p className="text-sm text-slate-500">Pay at the course — no in-app payments</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="outline">{call.skillLevel}</Badge>
        <Badge tone={VIBE_TONE[call.vibe]}>{call.vibe}</Badge>
        <Badge tone="outline" icon={call.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />}>
          {call.walkOrCart}
        </Badge>
      </div>

      {call.notes && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes from the host</p>
          <p className="text-sm text-slate-600">{call.notes}</p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <Users size={15} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800">
            Foursome ({call.joinedGolferIds.length}/{call.totalSpots})
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
                    {g.name} {g.id === currentUser.id && <span className="font-normal text-slate-400">(you)</span>}
                    {g.id === call.hostId && <span className="ml-1.5 text-xs font-medium text-sun-600">Host</span>}
                  </p>
                  <p className="text-xs text-slate-500">{g.handicap !== null ? `${g.handicap} handicap` : "No handicap yet"}</p>
                  <TrustBadgeRow golfer={g} className="mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {isHost && call.pendingRequestIds.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-bold text-slate-800">Requests to join</h2>
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
              Cancel this Golf Call
            </Button>
          ) : isJoined ? (
            <Button variant="outline" fullWidth onClick={() => setLeaveConfirmOpen(true)}>
              Leave round
            </Button>
          ) : isPending ? (
            <Button variant="outline" fullWidth onClick={() => cancelJoinRequest(call.id)}>
              Cancel request
            </Button>
          ) : isFull ? (
            <Button disabled fullWidth>
              Foursome full
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={() => setJoinConfirmOpen(true)}>
              {call.joinMode === "instant" ? "Join Round" : "Request to Join"}
            </Button>
          )}
        </div>
      )}

      {!isCompleted && !isCancelled && (isHost || isJoined) && (
        <button
          onClick={() => {
            simulateCallCompletion(call.id);
            showToast("Round marked completed — you can now leave reviews.", "info");
          }}
          className="self-center text-xs font-medium text-slate-400 underline-offset-2 transition-colors duration-200 hover:text-slate-600 hover:underline"
        >
          🧪 Simulate round completion (prototype)
        </button>
      )}

      {isCompleted && isJoined && (
        <div>
          <h2 className="mb-2 text-sm font-bold text-slate-800">Review your group</h2>
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
                      <Badge tone="fairway">Reviewed</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setReviewingId(gid)}>
                        Leave review
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
          <h2 className="text-sm font-bold text-slate-800">Group chat</h2>
        </div>
        {chatUnlocked ? (
          <GroupChat callId={call.id} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-8 text-center">
            <Lock size={18} className="text-slate-400" />
            <p className="text-sm text-slate-500">Join this Golf Call to unlock the group chat.</p>
          </div>
        )}
      </div>

      {host && !isHost && (
        <p className="text-center text-xs text-slate-400">Hosted by {host.name}</p>
      )}

      {leaveConfirmOpen && (
        <ConfirmDialog
          title="Leave this round?"
          message="You'll be removed from the foursome and lose access to the group chat. The host will be notified."
          confirmLabel="Leave round"
          danger
          onConfirm={() => {
            leaveGolfCall(call.id);
            setLeaveConfirmOpen(false);
            showToast("You left the round.", "info");
          }}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      )}
      {cancelConfirmOpen && (
        <ConfirmDialog
          title="Cancel this Golf Call?"
          message="Everyone who joined will be notified that the round is cancelled."
          confirmLabel="Cancel Golf Call"
          danger
          onConfirm={() => {
            cancelGolfCall(call.id);
            setCancelConfirmOpen(false);
            showToast("Golf Call cancelled.", "info");
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
    </div>
  );
}
