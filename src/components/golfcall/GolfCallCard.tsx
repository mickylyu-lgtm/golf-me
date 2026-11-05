import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { GolfCall, GolferProfile } from "../../types";
import { useData } from "../../context/DataContext";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { MatchReasons } from "../golfer/MatchReasons";
import { SharedPreferencesBadge } from "./SharedPreferencesBadge";
import { TeeTimeTrustBadge } from "./TeeTimeTrustBadge";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import { formatCompactDay, formatDate, formatMoney } from "../../lib/format";
import { skillLabel, vibeLabel, walkOrCartLabel } from "../../lib/enumLabels";
import { VIBE_TONE } from "../../lib/theme";
import { computeCallCompatibility } from "../../lib/compatibility";
import { matchTier, callMatchReasons, TIER_FOR_YOU_KEYS } from "../../lib/matchReasons";
import { evaluatePreferenceMatch } from "../../lib/preferenceMatch";
import { isPastRound } from "../../lib/golfCall";
import { roundedMiles } from "../../lib/geo";
import { useJoinRound } from "../../lib/useJoinRound";
import { ConfirmJoinModal } from "./ConfirmJoinModal";
import type { PreferenceMatchContext } from "../../lib/preferenceMatch";
import { useLocale } from "../../i18n/LocaleContext";

interface GolfCallCardProps {
  call: GolfCall;
  showMatch?: boolean;
  // Off where the page shows the same shared preferences itself (Auto-Match).
  showSharedPreferences?: boolean;
}

export function GolfCallCard({ call, showMatch = true, showSharedPreferences = true }: GolfCallCardProps) {
  const { currentUser, getGolfer, followingGolfers, circleGolfers, playedWithIds } = useData();
  const { t, locale } = useLocale();
  const navigate = useNavigate();

  const host = getGolfer(call.hostId);
  const openSpots = call.totalSpots - call.joinedGolferIds.length;
  const isHost = call.hostId === currentUser.id;
  // The host is shown inline with the "hosted by" line; the avatar row is for everyone else who joined.
  const otherJoinedIds = call.joinedGolferIds.filter((id) => id !== call.hostId);
  const isJoined = call.joinedGolferIds.includes(currentUser.id);
  const isPending = call.pendingRequestIds.includes(currentUser.id);
  const isFull = call.status === "full" || openSpots <= 0;
  const isCancelled = call.status === "cancelled";
  const isUrgent = !isFull && !isCancelled && openSpots === 1;
  const dateLabel = formatDate(call.dateISO, locale, t);
  const isSoon = call.status === "open" && (dateLabel === t("date.today") || dateLabel === t("date.tomorrow"));

  const breakdown = showMatch && !isHost ? computeCallCompatibility(currentUser, call) : null;
  const tier = breakdown ? matchTier(breakdown.overall) : null;
  // The distance is already in the card's first line; the round page keeps it as a reason.
  const reasons = breakdown ? callMatchReasons(call, breakdown, locale, t).filter((r) => r.key !== "distance") : [];

  const preferenceChecks = useMemo(() => {
    if (!showMatch || !showSharedPreferences || isHost) return [];
    const roster = call.joinedGolferIds.map(getGolfer).filter((g): g is GolferProfile => Boolean(g));
    const ctx: PreferenceMatchContext = {
      followingIds: new Set(followingGolfers.map((g) => g.id)),
      circleIds: new Set(circleGolfers.map((g) => g.id)),
      playedWithIds,
    };
    return evaluatePreferenceMatch(currentUser, currentUser.id, call, roster, ctx);
  }, [showMatch, showSharedPreferences, isHost, call, getGolfer, followingGolfers, circleGolfers, playedWithIds, currentUser]);

  // Same confirm sheet and join path as the round page (lib/useJoinRound):
  // Join opens "You're joining" with who's playing; only its confirm joins.
  const { joining, join } = useJoinRound(call);
  const [confirmOpen, setConfirmOpen] = useState(false);
  function handleJoin(e: React.MouseEvent) {
    e.stopPropagation();
    if (joining) return;
    setConfirmOpen(true);
  }

  let cta: React.ReactNode;
  if (isCancelled) {
    cta = <Badge tone="rose">{t("golfCallDetail.statusCancelled")}</Badge>;
  } else if (isHost) {
    cta = <Badge tone="fairway">{t("golfCallCard.youreHosting")}</Badge>;
  } else if (isJoined) {
    cta = <Badge tone="fairway">{t("golfCallCard.youreIn")}</Badge>;
  } else if (isPending) {
    cta = <Badge tone="sun">{t("golfCallCard.requestPending")}</Badge>;
  } else if (isPastRound(call)) {
    cta = <Badge tone="slate">{t("golfCallDetail.roundPassed")}</Badge>;
  } else if (isFull) {
    cta = <Badge tone="slate">{t("golfCallDetail.full")}</Badge>;
  } else {
    cta = (
      <Button size="sm" icon={<ArrowRight size={13} />} className="flex-row-reverse" disabled={joining} onClick={handleJoin}>
        {call.joinMode === "instant" ? t("golfCallDetail.joinRound") : t("golfCallDetail.requestToJoinButton")}
      </Button>
    );
  }

  // Skill and walk/cart only when they restrict who fits ("Any skill level" / "Either" say nothing).
  const constraints = [
    call.skillLevel !== "Any Skill Level" ? skillLabel(call.skillLevel, t) : null,
    call.walkOrCart !== "Either" ? walkOrCartLabel(call.walkOrCart, t) : null,
  ].filter((s): s is string => Boolean(s));

  const canJoin =!isCancelled && !isHost && !isJoined && !isPending && !isPastRound(call) && !isFull;

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/golf-calls/${call.id}`)}
      // Only the card itself: Enter on its Join button is that button's own click.
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && navigate(`/golf-calls/${call.id}`)}
      className={`flex w-full cursor-pointer flex-col gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS} ${isUrgent ? "border-sun-300" : ""}`}
    >
      <div>
        <p className="text-base font-bold text-slate-900">{call.course}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500">
          <span className={isSoon ? "font-bold text-fairway-700" : ""}>{formatCompactDay(call.dateISO, locale, t)}</span>
          <span>· {call.timeLabel}</span>
          <span className="text-slate-300">·</span>
          <span>
            {call.distanceMiles !== undefined && `${t("golfCallCard.miAway", { miles: roundedMiles(call.distanceMiles) })} · `}~
            {formatMoney(call.estimatedPricePerPerson)}
          </span>
        </p>
      </div>

      {/* One row: open spots, booking proof, then what the round asks for
          (vibe, plus skill and walk/cart only when they restrict anything).
          Cancelled/full is said once, by the action on the right. The one-
          spot-left badge keeps its colour but no longer pulses. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isCancelled || isFull ? null : isUrgent ? (
          <Badge tone="sun" className="font-bold tracking-wide uppercase">
            {t("golfCallDetail.oneSpotLeft")}
          </Badge>
        ) : (
          <Badge tone="fairway">
            {openSpots === 1
              ? t("golfCallCard.spotsRemainingSingular", { count: openSpots })
              : t("golfCallCard.spotsRemainingPlural", { count: openSpots })}
          </Badge>
        )}
        {/* Cancelled rounds keep verification metadata in the DB but never
            show an active badge — see TeeTimeTrustBadge's own gating too. */}
        {!isCancelled && <TeeTimeTrustBadge source={call.teeTimeSource} />}
        {/* Medium weight so the vibe reads as a descriptor, not the
            headline; Competitive also gets a lighter rose wash. Text colors
            are unchanged, so contrast stays at the tone's AA level. */}
        <Badge tone={VIBE_TONE[call.vibe]} className={`font-medium ${VIBE_TONE[call.vibe] === "rose" ? "bg-rose-50/60" : ""}`}>
          {vibeLabel(call.vibe, t)}
        </Badge>
        {constraints.length > 0 && <span className="whitespace-nowrap text-xs font-medium text-slate-500">{constraints.join(" · ")}</span>}
      </div>

      {/* Mobile: compact overlapping avatars of the OTHER golfers who joined —
          the host's avatar sits inline with "hosted by" in the footer, so a
          round with only its host shows no standalone avatar row. Full
          names/handicaps live one tap away on the detail page. */}
      {otherJoinedIds.length > 0 && (
        <div className="flex items-center gap-1.5 sm:hidden">
          <div className="flex -space-x-2">
            {otherJoinedIds.slice(0, 3).map((id) => {
              const g = getGolfer(id);
              if (!g) return null;
              return <Avatar key={id} golfer={g} size="xs" showVerified={false} />;
            })}
          </div>
          {otherJoinedIds.length > 3 && (
            <span className="text-xs font-semibold text-slate-500">+{otherJoinedIds.length - 3}</span>
          )}
        </div>
      )}

      {/* Desktop/tablet: roster chips with handicap for the OTHER golfers;
          the host is the "hosted by" line in the footer, as on mobile. */}
      <div className={`hidden flex-wrap gap-1.5 ${otherJoinedIds.length > 0 ? "sm:flex" : ""}`}>
        {otherJoinedIds.map((id) => {
          const g = getGolfer(id);
          if (!g) return null;
          return (
            <div key={id} className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-2.5 text-xs">
              <Avatar golfer={g} size="xs" showVerified={false} />
              <span className="font-semibold text-slate-700">{g.name.split(" ")[0]}</span>
              {g.verification.verifiedGolfer && <span className="text-fairway-500">✓</span>}
              <span className="text-slate-400">· {g.handicap !== null ? `${g.handicap} HCP` : t("golfCallCard.newGolfer")}</span>
            </div>
          );
        })}
      </div>

      {tier && (
        <div className="hidden rounded-xl bg-fairway-50/70 p-2.5 sm:block">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {t(TIER_FOR_YOU_KEYS[tier.tier])}
          </p>
          <MatchReasons reasons={reasons} className="mt-1" />
          {call.teeTimeSource === "user_verified" && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fairway-700">
              <span aria-hidden className="font-bold">✓</span> {t("golfCallDetail.bookingProofMatchReason")}
            </p>
          )}
          {/* "0 Shared Preferences" said nothing a card needs; the round page has the full breakdown. */}
          {preferenceChecks.some((c) => c.matched) && (
            <div className="mt-1.5 border-t border-fairway-100 pt-1.5">
              <SharedPreferencesBadge checks={preferenceChecks} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        <div className="min-w-0">
          {/* "N of M joined" repeated the open-spots badge; the host stays.
              Host avatar grouped directly with the "hosted by" text, at every width, so they never wrap apart. */}
          {host && (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">
                <Avatar golfer={host} size="xs" showVerified={false} />
              </span>
              <span className="truncate text-xs text-slate-400">
                {isHost ? t("golfCallCard.hostedByYou") : t("golfCallCard.hostedBy", { name: host.name })}
              </span>
            </div>
          )}
        </div>
        {cta}
      </div>
    </div>
    {/* Outside the card: the sheet is portalled, but React events still
        bubble through the component tree, and a tap inside it must not
        also open the round. */}
    {confirmOpen && canJoin && (
      <ConfirmJoinModal
        call={call}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void join();
        }}
      />
    )}
    </>
  );
}
