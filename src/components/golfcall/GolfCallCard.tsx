import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { GolfCall, GolferProfile } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { MatchReasons } from "../golfer/MatchReasons";
import { SharedPreferencesBadge } from "./SharedPreferencesBadge";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import { formatCompactDay, formatDate, formatMoney } from "../../lib/format";
import { VIBE_TONE } from "../../lib/theme";
import { computeCallCompatibility } from "../../lib/compatibility";
import { matchTier, callMatchReasons } from "../../lib/matchReasons";
import { evaluatePreferenceMatch } from "../../lib/preferenceMatch";
import { track } from "../../lib/analytics";
import type { PreferenceMatchContext } from "../../lib/preferenceMatch";

interface GolfCallCardProps {
  call: GolfCall;
  showMatch?: boolean;
}

export function GolfCallCard({ call, showMatch = true }: GolfCallCardProps) {
  const { currentUser, getGolfer, joinGolfCall, followingGolfers, circleGolfers, playedWithIds } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const host = getGolfer(call.hostId);
  const openSpots = call.totalSpots - call.joinedGolferIds.length;
  const isHost = call.hostId === currentUser.id;
  const isJoined = call.joinedGolferIds.includes(currentUser.id);
  const isPending = call.pendingRequestIds.includes(currentUser.id);
  const isFull = call.status === "full" || openSpots <= 0;
  const isCancelled = call.status === "cancelled";
  const isUrgent = !isFull && !isCancelled && openSpots === 1;
  const dateLabel = formatDate(call.dateISO);
  const isSoon = call.status === "open" && (dateLabel === "Today" || dateLabel === "Tomorrow");

  const breakdown = showMatch && !isHost ? computeCallCompatibility(currentUser, call) : null;
  const tier = breakdown ? matchTier(breakdown.overall) : null;
  const reasons = breakdown ? callMatchReasons(call, breakdown) : [];

  const preferenceChecks = useMemo(() => {
    if (!showMatch || isHost) return [];
    const roster = call.joinedGolferIds.map(getGolfer).filter((g): g is GolferProfile => Boolean(g));
    const ctx: PreferenceMatchContext = {
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      circleIds: new Set(circleGolfers.map((g) => g.id)),
      playedWithIds,
    };
    return evaluatePreferenceMatch(currentUser, currentUser.id, call, roster, ctx);
  }, [showMatch, isHost, call, getGolfer, followingGolfers, circleGolfers, playedWithIds, currentUser]);

  async function handleJoin(e: React.MouseEvent) {
    e.stopPropagation();
    track("first_round_joined");
    try {
      await joinGolfCall(call.id);
      showToast(
        call.joinMode === "instant" ? `You're playing ${formatDate(call.dateISO)}. ⛳` : "Request sent to the host.",
        "success",
      );
    } catch (err) {
      // Real, atomic failure (e.g. someone else took the last spot) —
      // surfaced, never a silent no-op.
      showToast(err instanceof Error ? err.message : "Couldn't join this round. Please try again.", "warning");
    }
  }

  let cta: React.ReactNode;
  if (isCancelled) {
    cta = <Badge tone="rose">Cancelled</Badge>;
  } else if (isHost) {
    cta = <Badge tone="fairway">You're hosting</Badge>;
  } else if (isJoined) {
    cta = <Badge tone="fairway">You're in</Badge>;
  } else if (isPending) {
    cta = <Badge tone="sun">Request pending</Badge>;
  } else if (isFull) {
    cta = <Badge tone="slate">Full</Badge>;
  } else {
    cta = (
      <Button size="sm" icon={<ArrowRight size={13} />} className="flex-row-reverse" onClick={handleJoin}>
        {call.joinMode === "instant" ? "Join Round" : "Request to Join"}
      </Button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/golf-calls/${call.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/golf-calls/${call.id}`)}
      className={`flex w-full cursor-pointer flex-col gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS} ${isUrgent ? "border-sun-300" : ""}`}
    >
      <div>
        <p className="text-base font-bold text-slate-900">{call.course}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500">
          <span className={isSoon ? "font-bold text-fairway-700" : ""}>{formatCompactDay(call.dateISO)}</span>
          <span>· {call.timeLabel}</span>
          <span className="text-slate-300">·</span>
          <span>
            {call.distanceMiles.toFixed(0)} mi away · ~{formatMoney(call.estimatedPricePerPerson)}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {isCancelled ? (
          <Badge tone="rose">Cancelled</Badge>
        ) : isFull ? (
          <Badge tone="slate">Foursome Full</Badge>
        ) : isUrgent ? (
          <Badge tone="sun" className="animate-pulse font-bold tracking-wide uppercase">
            1 Spot Left
          </Badge>
        ) : (
          <Badge tone="fairway">
            {openSpots} Spot{openSpots === 1 ? "" : "s"} Remaining
          </Badge>
        )}
      </div>

      {/* Mobile: compact overlapping avatars only — full names/handicaps live one tap away on the detail page. */}
      <div className="flex items-center gap-1.5 sm:hidden">
        <div className="flex -space-x-2">
          {call.joinedGolferIds.slice(0, 3).map((id) => {
            const g = getGolfer(id);
            if (!g) return null;
            return <Avatar key={id} golfer={g} size="xs" showVerified={false} />;
          })}
        </div>
        {call.joinedGolferIds.length > 3 && (
          <span className="text-xs font-semibold text-slate-500">+{call.joinedGolferIds.length - 3}</span>
        )}
      </div>

      {/* Desktop/tablet: full roster chips with handicap + host tag. */}
      <div className="hidden flex-wrap gap-1.5 sm:flex">
        {call.joinedGolferIds.map((id) => {
          const g = getGolfer(id);
          if (!g) return null;
          return (
            <div key={id} className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-2.5 text-xs">
              <Avatar golfer={g} size="xs" showVerified={false} />
              <span className="font-semibold text-slate-700">{g.name.split(" ")[0]}</span>
              {g.verification.verifiedGolfer && <span className="text-fairway-600">✓</span>}
              <span className="text-slate-400">· {g.handicap !== null ? `${g.handicap} HCP` : "New"}</span>
              {g.id === call.hostId && <span className="font-semibold text-sun-600">· Host</span>}
            </div>
          );
        })}
      </div>

      <Badge tone={VIBE_TONE[call.vibe]} className="self-start font-semibold">
        {call.vibe}
      </Badge>

      {tier && (
        <div className="hidden rounded-xl bg-fairway-50/70 p-2.5 sm:block">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {tier.label} for you
          </p>
          <MatchReasons reasons={reasons} className="mt-1" />
          {preferenceChecks.length > 0 && (
            <div className="mt-1.5 border-t border-fairway-100 pt-1.5">
              <SharedPreferencesBadge checks={preferenceChecks} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <p className="text-xs font-medium text-slate-500">
          {call.joinedGolferIds.length} of {call.totalSpots} joined
          {host && <span className="text-slate-400"> · hosted by {isHost ? "you" : host.name}</span>}
        </p>
        {cta}
      </div>
    </div>
  );
}
