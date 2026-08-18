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
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserPlus,
  UserRoundCheck,
  UserRoundPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ReportModal } from "../components/trust/ReportModal";
import { CompareModal } from "../components/golfer/CompareModal";
import { MatchReasons } from "../components/golfer/MatchReasons";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { TrustBadgeRow } from "../components/golfer/TrustBadges";
import { CredibilityBadge } from "../components/golfer/CredibilityBadge";
import { computeCompatibility } from "../lib/compatibility";
import { matchTier, golferMatchReasons } from "../lib/matchReasons";
import { computeCredibility, computeHandicapConfidence } from "../lib/credibility";
import { useCredibilityStats } from "../lib/useCredibility";
import { formatBudgetRange, handicapLabel, isNewAccount, paceLabel } from "../lib/format";
import { vibeLabel, walkOrCartLabel } from "../lib/enumLabels";
import { VIBE_TONE } from "../lib/theme";
import { useIsCoachReviewer } from "../lib/useIsCoachReviewer";

// Stable (module-level, not re-created per render) zeroed fallback for the
// brief window before the route's golfer id resolves — useCredibilityStats
// is called unconditionally per the rules of hooks, so it needs a baseline
// even when `golfer` itself is still undefined.
const EMPTY_REPUTATION = { completedRounds: 0, showUpRatePct: 0, wouldPlayAgainPct: 0, onTimePct: 0, respectfulPct: 0, goodPacePct: 0 };

export function GolferProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    getGolfer,
    isBlocked,
    blockUser,
    unblockUser,
    hasPlayedWith,
    isInCircle,
    addToCircle,
    reviewsAbout,
    isFollowing,
    followUser,
    unfollowUser,
    canMessage,
  } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const golfer = id ? getGolfer(id) : undefined;
  const compat = useMemo(() => (golfer ? computeCompatibility(currentUser, golfer) : null), [currentUser, golfer]);
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

  if (id === currentUser.id) return <Navigate to="/profile" replace />;
  if (!golfer) {
    return (
      <div className="py-12 text-center text-slate-500">
        Golfer not found.
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const blocked = isBlocked(golfer.id);
  const following = isFollowing(golfer.id);
  const messagingAllowed = canMessage(golfer.id);
  const tier = compat ? matchTier(compat.overall) : null;
  const reasons = compat ? golferMatchReasons(compat) : [];
  const enrichedGolfer = { ...golfer, reputation: realReputation };
  const isEstablished = !isNewAccount(enrichedGolfer.reputation.completedRounds);
  const golferReviews = reviewsAbout(golfer.id);
  const credibility = computeCredibility(enrichedGolfer, golferReviews);
  const handicapConfidence = realHandicapConfidence ?? computeHandicapConfidence(golferReviews);

  const feedbackTags = isEstablished
    ? [
        { label: "Good Pace", count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.goodPacePct) / 100) },
        { label: "Respectful", count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.respectfulPct) / 100) },
        { label: "On Time", count: Math.round((enrichedGolfer.reputation.completedRounds * enrichedGolfer.reputation.onTimePct) / 100) },
      ].filter((t) => t.count > 0)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More options"
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
                <ShieldAlert size={15} /> Report {golfer.name}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (blocked) {
                    unblockUser(golfer.id);
                    showToast(`Unblocked ${golfer.name}.`, "info");
                  } else {
                    setBlockConfirmOpen(true);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors duration-150 hover:bg-red-50"
              >
                <ShieldOff size={15} /> {blocked ? `Unblock ${golfer.name}` : `Block ${golfer.name}`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar golfer={golfer} size="lg" />
        <div>
          <h1 className="flex items-center justify-center gap-1 text-xl font-bold text-slate-900">
            {golfer.name}
            {golfer.verification.verifiedGolfer && <ShieldCheck size={16} className="text-fairway-600" />}
          </h1>
          <p className="text-sm text-slate-500">
            {handicapLabel(golfer.handicap, t)} · {golfer.areaLabel}
          </p>
          <p className="flex items-center justify-center gap-1 text-xs text-slate-400">
            <MapPin size={11} /> {golfer.distanceMiles.toFixed(1)} mi away
          </p>
        </div>
        <CredibilityBadge tier={credibility.tier} size="sm" />
        {isCoachReviewer && (
          <Badge tone="fairway" icon={<ShieldCheck size={12} />}>
            Coach Reviewer
          </Badge>
        )}
        <TrustBadgeRow golfer={enrichedGolfer} />

        {!blocked && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant={following ? "outline" : "primary"}
              icon={following ? <UserRoundCheck size={14} /> : <UserRoundPlus size={14} />}
              onClick={async () => {
                try {
                  if (following) {
                    await unfollowUser(golfer.id);
                    showToast(`Unfollowed ${golfer.name}.`, "info");
                  } else {
                    await followUser(golfer.id);
                    showToast(`Following ${golfer.name}.`, "success");
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : "Couldn't update follow status. Please try again.", "warning");
                }
              }}
            >
              {following ? t("common.following") : t("common.follow")}
            </Button>
            {/* messagingAllowed is false here only when they've blocked us
                (self and "we blocked them" are already covered by !blocked
                above) — silently hide rather than surface their block. */}
            {messagingAllowed && (
              <Button
                size="sm"
                variant="outline"
                icon={<MessageCircle size={14} />}
                onClick={() => navigate(`/messages/${golfer.id}`)}
              >
                Message
              </Button>
            )}
            <Button size="sm" variant="outline" icon={<Scale size={14} />} onClick={() => setCompareOpen(true)}>
              Compare
            </Button>
          </div>
        )}

        {hasPlayedWith(golfer.id) &&
          (isInCircle(golfer.id) ? (
            <Badge tone="fairway" icon={<Users size={12} />}>
              In your Golf Circle
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={<UserPlus size={14} />}
              onClick={() => {
                addToCircle(golfer.id);
                showToast(`Added ${golfer.name} to your Golf Circle.`, "success");
              }}
            >
              Add to Golf Circle
            </Button>
          ))}
      </div>

      {blocked && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-sm text-slate-600">
          You've blocked {golfer.name}. You won't see each other's profiles or Golf Calls.
        </div>
      )}

      {tier && (
        <div className="rounded-2xl bg-fairway-50/70 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
            <span aria-hidden>{tier.emoji}</span> {tier.label} for you
          </p>
          <MatchReasons reasons={reasons} className="mt-1.5" />
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="text-sm leading-relaxed text-slate-600">{golfer.bio}</p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">GolfMe Reputation</p>
        <ReputationRow golfer={enrichedGolfer} />
        {handicapConfidence.level !== "normal" && (
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
            {handicapConfidence.level === "high" && <ShieldCheck size={12} className="text-fairway-600" />}
            {handicapConfidence.level === "high"
              ? "Handicap usually confirmed by playing partners"
              : "Handicap accuracy has been questioned by multiple playing partners"}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Playing Style</p>
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
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Golf Circle</p>
          <p className="font-bold text-slate-800">
            {golfer.circleSize} golfer{golfer.circleSize === 1 ? "" : "s"} {golfer.circleSize === 0 ? "(just getting started)" : "would play with them again"}
          </p>
        </div>
      </div>

      {feedbackTags.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Common Feedback</p>
          <div className="flex flex-wrap gap-1.5">
            {feedbackTags.map((t) => (
              <Badge key={t.label} tone="outline">
                {t.label} ×{t.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Wallet size={12} /> Budget / round
          </p>
          <p className="mt-1 font-bold text-slate-800">
            {formatBudgetRange(golfer.budgetMin, golfer.budgetMax, golfer.noBudgetPreference, t)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Availability</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{golfer.availability.length} time slots/week</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Free</p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.availability.map((a) => (
            <Badge key={a} tone="outline">
              {a}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Flag size={12} /> Favorite courses
        </p>
        <div className="flex flex-wrap gap-1.5">
          {golfer.favoriteCourses.map((c) => (
            <Badge key={c} tone="outline">
              {c}
            </Badge>
          ))}
        </div>
      </div>

      {compareOpen && <CompareModal other={golfer} onClose={() => setCompareOpen(false)} />}

      {reportOpen && (
        <ReportModal reportedId={golfer.id} reportedName={golfer.name} context="profile" onClose={() => setReportOpen(false)} />
      )}
      {blockConfirmOpen && (
        <ConfirmDialog
          title={`Block ${golfer.name}?`}
          message="You won't see each other's profiles or Golf Calls, and they won't be able to message you. You can unblock anytime from this profile."
          confirmLabel="Block"
          danger
          onConfirm={() => {
            blockUser(golfer.id);
            setBlockConfirmOpen(false);
            showToast(`Blocked ${golfer.name}.`, "info");
          }}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}
    </div>
  );
}
