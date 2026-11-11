import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Car,
  Flag,
  Footprints,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useRealRounds } from "../context/RealRoundsContext";
import { useRealSocial } from "../context/RealSocialContext";
import { useRealCommunity } from "../context/RealCommunityContext";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { LoadErrorState } from "../components/ui/LoadStates";
import { useLocale } from "../i18n/LocaleContext";
import { FollowControl } from "../components/profile/FollowControl";
import { ProfileFollowers, ProfileMutualSummary } from "../components/profile/ProfileFollowers";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ReportModal } from "../components/trust/ReportModal";
import { CompareModal } from "../components/golfer/CompareModal";
import { MatchReasons } from "../components/golfer/MatchReasons";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { TrustBadgeRow } from "../components/golfer/TrustBadges";
import { FoundingGolferBadge, FoundingMark } from "../components/golfer/FoundingGolfer";
import { ReputationBadge } from "../components/golfer/ReputationBadge";
import { computeCompatibility, golferDistanceMiles } from "../lib/compatibility";
import { matchTier, golferMatchReasons, TIER_FOR_YOU_KEYS } from "../lib/matchReasons";
import { golferDistanceLabel } from "../lib/publicDirectory";
import { useInviteToPlay } from "../lib/useInviteToPlay";
import { computeHandicapConfidence } from "../lib/credibility";
import { useCredibilityStats } from "../lib/useCredibility";
import { useReputationState } from "../lib/useReputationState";
import { formatBudgetRange, isNewAccount, paceLabel } from "../lib/format";
import { formatHandicapNumber, handicapColorClass, hasHandicap } from "../lib/handicapColor";
import { isFounder } from "../lib/founder";
import { availabilityLabel, vibeLabel, walkOrCartLabel } from "../lib/enumLabels";
import { VIBE_TONE } from "../lib/theme";
import { useIsCoachReviewer } from "../lib/useIsCoachReviewer";
import { goBack } from "../lib/goBack";

// Stable (module-level, not re-created per render) zeroed fallback for the
// brief window before the route's golfer id resolves — useCredibilityStats
// is called unconditionally per the rules of hooks, so it needs a baseline
// even when `golfer` itself is still undefined.
const EMPTY_REPUTATION = { completedRounds: 0, showUpRatePct: 0, wouldPlayAgainPct: 0, onTimePct: 0, respectfulPct: 0, goodPacePct: 0 };

export function GolferProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const inviteToPlay = useInviteToPlay();
  const {
    currentUser,
    getGolfer,
    isBlocked,
    isBlockedEitherWay,
    blockUser,
    unblockUser,
    hasPlayedWith,
    isInCircle,
    addToCircle,
    reviewsAbout,
    canMessage,
  } = useData();
  const realRounds = useRealRounds();
  const realSocial = useRealSocial();
  const realCommunity = useRealCommunity();
  const { hasLoaded: roundsLoaded } = realRounds;
  const { hasLoaded: socialLoaded } = realSocial;
  const { hasLoaded: communityLoaded } = realCommunity;
  const failedSources = [realRounds, realSocial, realCommunity].filter((s) => s.loadError);
  const { showToast } = useToast();
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const golfer = id ? getGolfer(id) : undefined;
  const compat = useMemo(() => (golfer ? computeCompatibility(currentUser, golfer) : null), [currentUser, golfer]);
  // Range for a server bucket, whole miles for a real distance, nothing if unknown.
  const distanceLabel = golfer ? golferDistanceLabel(golfer, golferDistanceMiles(currentUser, golfer), t) : undefined;
  // Real accounts: golfer.reputation and the review corpus come from a live
  // server aggregate (get_credibility_stats) — round_reviews' raw rows are
  // reviewer-only, so `reviewsAbout(golfer.id)` is correctly always empty
  // for someone else's real profile. Demo mode falls straight through
  // unchanged (real* values just mirror the baseline already on golfer).
  // Called unconditionally (before the early returns below) per the rules
  // of hooks — golfer?.id/reputation may briefly be undefined while the
  // route param resolves, which the hook itself already handles.
  const { reputation: realReputation, handicapConfidence: realHandicapConfidence } = useCredibilityStats(
    golfer?.id,
    golfer?.reputation ?? EMPTY_REPUTATION,
  );
  const isCoachReviewer = useIsCoachReviewer(golfer?.id);
  // Also called unconditionally, same reason as useCredibilityStats above.
  const { state: reputationState } = useReputationState(golfer);

  if (id === currentUser.id) return <Navigate to="/profile" replace />;
  // Opened cold, the profile caches (rounds / social / community) may not
  // have loaded yet — wait rather than flash "Golfer not found".
  if (!golfer && !(roundsLoaded && socialLoaded && communityLoaded)) return <GolfMeLoader className="py-12" />;
  // A profile cache never loaded: that's a connection problem, not "not found".
  if (!golfer && failedSources.length > 0) {
    return failedSources.some((s) => s.isLoading) ? (
      <GolfMeLoader className="py-12" />
    ) : (
      <LoadErrorState onRetry={() => Promise.all(failedSources.map((s) => s.retry())).then(() => undefined)} />
    );
  }
  if (!golfer) {
    return (
      <div className="py-12 text-center text-slate-500">
        {t("golferProfile.notFound")}
        <div className="mt-4">
          <Button variant="outline" onClick={() => goBack(navigate, "/find")}>
            {t("golfCallDetail.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  const blocked = isBlocked(golfer.id);
  const messagingAllowed = canMessage(golfer.id);
  const tier = compat ? matchTier(compat.overall) : null;
  const reasons = compat ? golferMatchReasons(compat, t, distanceLabel) : [];
  const enrichedGolfer = { ...golfer, reputation: realReputation };
  const isEstablished = !isNewAccount(enrichedGolfer.reputation.completedRounds);
  const golferReviews = reviewsAbout(golfer.id);
  const handicapConfidence = realHandicapConfidence ?? computeHandicapConfidence(golferReviews);

  const feedbackTags = isEstablished
    ? [
        { label: t("golferProfile.feedbackGoodPace"), count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.goodPacePct) / 100) },
        { label: t("golferProfile.feedbackRespectful"), count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.respectfulPct) / 100) },
        { label: t("golferProfile.feedbackOnTime"), count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.onTimePct) / 100) },
      ].filter((tag) => tag.count > 0)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => goBack(navigate, "/find")}
          className="-my-2.5 flex items-center gap-1.5 rounded-full px-1 py-2.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t("golfCallDetail.moreOptions")}
            aria-expanded={menuOpen}
            className="rounded-full p-2 text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors duration-150 hover:bg-slate-50"
              >
                <ShieldAlert size={15} /> {t("golferProfile.report", { name: golfer.name })}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (blocked) {
                    unblockUser(golfer.id).then(
                      () => showToast(t("golferProfile.unblockedToast", { name: golfer.name }), "info"),
                      () => showToast(t("golferProfile.unblockFailed", { name: golfer.name }), "warning"),
                    );
                  } else {
                    setBlockConfirmOpen(true);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors duration-150 hover:bg-red-50"
              >
                <ShieldOff size={15} /> {blocked ? t("golferProfile.unblock", { name: golfer.name }) : t("golferProfile.block", { name: golfer.name })}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar golfer={golfer} size="lg" magnifyOnTap />
        <div>
          <h1 className="flex items-center justify-center gap-1 text-xl font-bold text-slate-900">
            {golfer.name}
            <FoundingMark golfer={golfer} />
            {golfer.verification.verifiedGolfer && <ShieldCheck size={16} className="text-fairway-600" />}
          </h1>
          {(isFounder(golfer.id) || golfer.foundingMemberNumber != null) && (
            <div className="mb-1 mt-1.5 flex justify-center">
              <FoundingGolferBadge golfer={golfer} />
            </div>
          )}
          <p className="text-sm text-slate-500">
            {/* Same handicap treatment as your own profile, cards, and Compare.
                This ability signal is separate from Reputation/verification. */}
            {!hasHandicap(golfer.handicap) ? (
              t("golfCallDetail.noHandicapYet")
            ) : (
              <>
                {t("profile.handicapPrefix")}
                <span className={handicapColorClass(golfer.handicap)}>{formatHandicapNumber(golfer.handicap)}</span>
              </>
            )}{" "}
            · {golfer.areaLabel}
          </p>
          {distanceLabel !== undefined && (
            <p className="flex items-center justify-center gap-1 text-xs text-slate-400">
              <MapPin size={11} /> {distanceLabel}
            </p>
          )}
        </div>
        <ProfileMutualSummary profileId={golfer.id} name={golfer.name} />
        <ReputationBadge tier={reputationState?.tierKey ?? null} size="sm" />
        {isCoachReviewer && (
          <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
            {t("golferProfile.coachReviewer")}
          </Badge>
        )}
        <TrustBadgeRow golfer={enrichedGolfer} />

        {!blocked && (
          <div className="flex w-full max-w-sm flex-col items-center gap-2">
            {/* Message is the main thing to do here; Invite to play opens the
                same thread with a suggested message the golfer sends (or
                edits) themselves. messagingAllowed is false here only when
                they've blocked us (self and "we blocked them" are already
                covered by !blocked above) — silently hide rather than
                surface their block. */}
            {messagingAllowed && (
              <div className="flex w-full items-center gap-2">
                <Button className="flex-1" icon={<MessageCircle size={15} />} onClick={() => navigate(`/messages/${golfer.id}`)}>
                  {t("golferProfile.message")}
                </Button>
                <Button className="flex-1" variant="outline" icon={<Send size={15} />} onClick={() => inviteToPlay(golfer)}>
                  {t("golferProfile.inviteToPlay")}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <FollowControl profileId={golfer.id} name={golfer.name} />
              <Button size="sm" variant="outline" icon={<Scale size={14} />} onClick={() => setCompareOpen(true)}>
                {t("golferProfile.compare")}
              </Button>
            </div>
          </div>
        )}

        {hasPlayedWith(golfer.id) &&
          (isInCircle(golfer.id) ? (
            <Badge tone="fairway" icon={<Users size={12} />}>
              {t("golferProfile.inYourCircle")}
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={<UserPlus size={14} />}
              onClick={() => {
                addToCircle(golfer.id);
                showToast(t("golferProfile.addedToCircle", { name: golfer.name }), "success");
              }}
            >
              {t("golferProfile.addToCircle")}
            </Button>
          ))}
      </div>

      {blocked && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-600">
          {t("golferProfile.blockedNotice", { name: golfer.name })}
        </div>
      )}

      {tier && (
        <div className="rounded-2xl bg-fairway-50/70 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {t(TIER_FOR_YOU_KEYS[tier.tier])}
          </p>
          <MatchReasons reasons={reasons} className="mt-1.5" />
        </div>
      )}

      {/* No bio yet (a new golfer) means no empty card. */}
      {golfer.bio?.trim() && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-sm leading-relaxed text-slate-600">{golfer.bio}</p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.reputationTitle")}</p>
        <ReputationRow golfer={enrichedGolfer} followerStat={!isBlockedEitherWay(golfer.id) ? <ProfileFollowers profileId={golfer.id} layout="stat" /> : undefined} />
        {handicapConfidence.level !== "normal" && (
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
            {handicapConfidence.level === "high" && <ShieldCheck size={12} className="text-fairway-600" />}
            {handicapConfidence.level === "high" ? t("golferProfile.handicapConfirmed") : t("golferProfile.handicapQuestioned")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.playingStyle")}</p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.vibes.map((v) => (
            <Badge key={v} tone={VIBE_TONE[v]}>
              {vibeLabel(v, t)}
            </Badge>
          ))}
          {isEstablished && <Badge tone="outline">{paceLabel(enrichedGolfer.reputation.goodPacePct, t)}</Badge>}
          <Badge tone="outline" icon={golfer.walkOrCart === "Walking" ? <Footprints size={12} /> : <Car size={12} />}>
            {walkOrCartLabel(golfer.walkOrCart, t)}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4">
        <Users size={18} className="text-fairway-600" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.circleTitle")}</p>
          <p className="font-bold text-slate-800">
            {golfer.circleSize === 0
              ? t("golferProfile.circleNone")
              : golfer.circleSize === 1
                ? t("golferProfile.circleOne")
                : t("golferProfile.circleMany", { count: golfer.circleSize })}
          </p>
        </div>
      </div>

      {feedbackTags.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.commonFeedback")}</p>
          <div className="flex flex-wrap gap-1.5">
            {feedbackTags.map((tag) => (
              <Badge key={tag.label} tone="outline">
                {tag.label} ×{tag.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wallet size={12} /> {t("golferProfile.budgetTitle")}
          </p>
          <p className="mt-1 font-bold text-slate-800">
            {formatBudgetRange(golfer.budgetMin, golfer.budgetMax, golfer.noBudgetPreference, t)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.availabilityTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {golfer.availability.length === 0
              ? t("golferProfile.availabilityNone")
              : golfer.availability.length === 1
                ? t("golferProfile.availabilityOne")
                : t("golferProfile.availabilityMany", { count: golfer.availability.length })}
          </p>
        </div>
      </div>

      {/* Left out rather than shown as an empty heading for a new golfer. */}
      {golfer.availability.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("golferProfile.freeTitle")}</p>
          <div className="flex flex-wrap gap-1.5">
            {golfer.availability.map((a) => (
              <Badge key={a} tone="outline">
                {availabilityLabel(a, t)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {golfer.favoriteCourses.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Flag size={12} /> {t("golferProfile.favoriteCourses")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {golfer.favoriteCourses.map((c) => (
              <Badge key={c} tone="outline">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {compareOpen && <CompareModal other={golfer} onClose={() => setCompareOpen(false)} />}

      {reportOpen && (
        <ReportModal reportedId={golfer.id} reportedName={golfer.name} context="profile" onClose={() => setReportOpen(false)} />
      )}
      {blockConfirmOpen && (
        <ConfirmDialog
          title={t("golferProfile.blockConfirmTitle", { name: golfer.name })}
          message={t("golferProfile.blockConfirmMessage")}
          confirmLabel={t("golferProfile.blockConfirmLabel")}
          danger
          onConfirm={async () => {
            try {
              await blockUser(golfer.id);
            } catch {
              showToast(t("golferProfile.blockFailed", { name: golfer.name }), "warning");
              return;
            }
            setBlockConfirmOpen(false);
            showToast(t("golferProfile.blockedToast", { name: golfer.name }), "info");
          }}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}
