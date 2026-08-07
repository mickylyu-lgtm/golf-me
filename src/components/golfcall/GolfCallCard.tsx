import { useNavigate } from "react-router-dom";
import { CalendarDays, Eye, MapPin, Users, Wallet } from "lucide-react";
import type { GolfCall } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CompatibilityBadge } from "../golfer/CompatibilityBadge";
import { formatDate, formatMoney } from "../../lib/format";
import { VIBE_TONE } from "../../lib/theme";

interface GolfCallCardProps {
  call: GolfCall;
  matchScore?: number;
}

export function GolfCallCard({ call, matchScore }: GolfCallCardProps) {
  const { currentUser, getGolfer, joinGolfCall } = useData();
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
  const isSoon = call.status === "open" && (formatDate(call.dateISO) === "Today" || formatDate(call.dateISO) === "Tomorrow");

  function handleJoin(e: React.MouseEvent) {
    e.stopPropagation();
    joinGolfCall(call.id);
    showToast(
      call.joinMode === "instant" ? "You're in! Check the group for details." : "Request sent to the host.",
      "success",
    );
  }

  function handleView(e: React.MouseEvent) {
    e.stopPropagation();
    navigate(`/golf-calls/${call.id}`);
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
      <>
        <Button size="sm" variant="outline" icon={<Eye size={13} />} onClick={handleView}>
          View
        </Button>
        <Button size="sm" onClick={handleJoin}>
          {call.joinMode === "instant" ? "I'm In" : "Request"}
        </Button>
      </>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/golf-calls/${call.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/golf-calls/${call.id}`)}
      className={`flex w-full cursor-pointer flex-col gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm shadow-slate-900/[0.03] transition hover:-translate-y-0.5 hover:shadow-md ${
        isUrgent ? "border-sun-300 hover:border-sun-400" : "border-slate-100 hover:border-fairway-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-slate-900">{call.course}</p>
          <p className={`flex items-center gap-1 text-xs font-medium ${isSoon ? "text-fairway-700" : "text-slate-500"}`}>
            <CalendarDays size={12} /> {formatDate(call.dateISO)} · {call.timeLabel}
          </p>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <MapPin size={12} /> {call.distanceMiles.toFixed(0)} mi away · {call.areaLabel}
          </p>
        </div>
        {matchScore !== undefined && <CompatibilityBadge score={matchScore} size="sm" />}
      </div>

      <div>
        {isCancelled ? (
          <Badge tone="rose">Cancelled</Badge>
        ) : isFull ? (
          <Badge tone="slate">Foursome Full</Badge>
        ) : isUrgent ? (
          <Badge tone="sun" className="animate-pulse">
            🏌️ 1 Spot Left
          </Badge>
        ) : (
          <Badge tone="fairway">
            {openSpots} Spot{openSpots === 1 ? "" : "s"} Remaining
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {call.joinedGolferIds.map((id) => {
          const g = getGolfer(id);
          if (!g) return null;
          return (
            <div key={id} className="flex items-center gap-1.5 text-xs text-slate-600">
              <Avatar golfer={g} size="xs" showVerified={false} />
              <span className="font-medium text-slate-700">{g.name.split(" ")[0]}</span>
              {g.verification.verifiedGolfer && <span className="text-fairway-600">✓</span>}
              <span className="text-slate-400">·</span>
              <span>{g.handicap !== null ? `${g.handicap} HCP` : "New golfer"}</span>
              {g.id === call.hostId && <span className="text-[10px] font-semibold text-sun-600">HOST</span>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone="outline" icon={<Wallet size={12} />}>
          Approx. {formatMoney(call.estimatedPricePerPerson)}/person
        </Badge>
        <Badge tone="outline">{call.skillLevel}</Badge>
        <Badge tone={VIBE_TONE[call.vibe]}>{call.vibe}</Badge>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
          <Users size={12} />
          {call.joinedGolferIds.length} of {call.totalSpots} joined
          {host && <span className="text-slate-400"> · hosted by {isHost ? "you" : host.name}</span>}
        </p>
        <div className="flex items-center gap-2">{cta}</div>
      </div>
    </div>
  );
}
