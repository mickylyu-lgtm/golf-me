import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Mail, Phone, ShieldCheck } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { ReputationBadge, ReputationShieldIcon } from "../components/golfer/ReputationBadge";
import { VerifyStepModal } from "../components/profile/VerifyStepModal";
import { computeHandicapConfidence } from "../lib/credibility";
import { useCredibilityStats } from "../lib/useCredibility";
import { useReputationState } from "../lib/useReputationState";
import { TIER_DEFS, tierDisplayName } from "../lib/reputationTiers";
import { supabase } from "../lib/supabase";

export function ReputationDetail() {
  const { currentUser, reviewsAbout, setPhoneVerified, setEmailVerified, requestVerifiedGolfer } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email" | null>(null);
  const [resending, setResending] = useState(false);

  // Real accounts: reputation/handicap-confidence come from live server
  // aggregates (get_credibility_stats, get_reputation_state), never raw
  // review rows — those stay reviewer-only. Demo mode: falls straight
  // through to the existing client-side computations, unchanged.
  const { reputation: realReputation, handicapConfidence: realHandicapConfidence } = useCredibilityStats(currentUser.id, currentUser.reputation);
  const enrichedUser = { ...currentUser, reputation: realReputation };
  const { state: reputationState } = useReputationState(currentUser);
  const myReviews = reviewsAbout(currentUser.id);
  const handicapConfidence = realHandicapConfidence ?? computeHandicapConfidence(myReviews);

  // Real accounts: email verification is real Supabase Auth state
  // (auth.users.email_confirmed_at, set by Google OAuth / email-OTP
  // sign-in — never a client-settable column). Phone verification has no
  // real backing signal yet — no phone number is even collected, and a
  // "Verify" button there would be exactly the kind of demo-only
  // affordance this was built to stop presenting as real. Demo mode keeps
  // the existing local-only toggle simulation unchanged; it never touches
  // real Supabase and is clearly labeled as a prototype.
  const emailVerified = isDemo ? currentUser.verification.emailVerified : Boolean(authUser?.email_confirmed_at);
  const phoneVerified = isDemo ? currentUser.verification.phoneVerified : false;
  const verifiedGolfer = isDemo ? currentUser.verification.verifiedGolfer : false;
  const canApplyVerifiedGolfer = phoneVerified && emailVerified && !verifiedGolfer;

  async function resendConfirmationEmail() {
    if (!authUser?.email) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: authUser.email });
      if (error) throw error;
      showToast(t("reputation.emailResent"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't resend the confirmation email. Please try again.", "warning");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("reputation.title")}</h1>
        <div className="mt-3 flex items-center gap-3">
          <ReputationShieldIcon tier={reputationState?.tierKey ?? null} size={64} />
          <ReputationBadge tier={reputationState?.tierKey ?? null} />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("reputation.whatItMeans")}</p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ReputationShieldIcon tier={reputationState?.tierKey ?? null} size={20} />
            {reputationState ? (
              <span className="text-sm font-bold text-slate-800">{tierDisplayName(reputationState.tierKey, t)}</span>
            ) : (
              <span aria-hidden="true" className="h-4 w-24 animate-pulse rounded-full bg-slate-200" />
            )}
          </div>
          {reputationState ? (
            <span className="text-xs font-semibold text-slate-500">
              {reputationState.nextTierKey
                ? t("reputation.pointsToNextTier", {
                    points: reputationState.pointsToNextTier ?? 0,
                    tier: tierDisplayName(reputationState.nextTierKey, t),
                  })
                : t("reputation.maxTierReached")}
            </span>
          ) : (
            <span aria-hidden="true" className="h-3 w-20 animate-pulse rounded-full bg-slate-200" />
          )}
        </div>
        {reputationState?.nextTierKey && (
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-forest to-brand-forest-deep transition-all duration-300"
              style={{
                // Truthful in-tier percentage: (points - currentTierMin) /
                // (nextTierMin - currentTierMin), clamped 0-100 -- never the
                // fraction of total lifetime points, which would understate
                // progress for anyone who isn't in the very first tier.
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round(
                      ((reputationState.points - TIER_DEFS[reputationState.tierKey].minPoints) /
                        (TIER_DEFS[reputationState.nextTierKey].minPoints - TIER_DEFS[reputationState.tierKey].minPoints)) *
                        100,
                    ),
                  ),
                )}%`,
              }}
            />
          </div>
        )}
        <div className="mt-3 flex gap-4 text-xs text-slate-500">
          <span>
            <strong className="font-semibold text-slate-800">{reputationState?.qualifyingRounds ?? 0}</strong> {t("reputation.qualifyingRounds")}
          </span>
          <span>
            <strong className="font-semibold text-slate-800">{reputationState?.hostedRounds ?? 0}</strong> {t("reputation.hostedRounds")}
          </span>
        </div>
        <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("reputation.howToImprove")}</p>
        <ul className="flex flex-col gap-1 text-xs text-slate-500">
          <li>{t("reputation.milestoneFirstRound")}</li>
          <li>{t("reputation.milestoneHostOrJoin")}</li>
          <li>{t("reputation.milestoneConsistent")}</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <ReputationRow golfer={enrichedUser} />
        {handicapConfidence.level !== "normal" && (
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
            {handicapConfidence.level === "high" && <ShieldCheck size={12} className="text-fairway-600" />}
            {handicapConfidence.level === "high" ? t("reputation.handicapConfirmed") : t("reputation.handicapQuestioned")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("reputation.trustVerification")}</p>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <Phone size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("reputation.phoneNumber")}</p>
              <p className="text-xs text-slate-500">{t("reputation.neverShown")}</p>
            </div>
            {phoneVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                {t("reputation.verified")}
              </Badge>
            ) : isDemo ? (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("phone")}>
                {t("reputation.verify")}
              </Button>
            ) : (
              // No real phone-verification path exists yet (no phone number
              // is even collected) -- disabled and honestly labeled rather
              // than offering a button that can't actually do anything.
              <Button size="sm" variant="outline" disabled>
                {t("reputation.comingSoon")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <Mail size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("reputation.emailAddress")}</p>
              <p className="text-xs text-slate-500">{t("reputation.neverShown")}</p>
            </div>
            {emailVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                {t("reputation.verified")}
              </Badge>
            ) : isDemo ? (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("email")}>
                {t("reputation.verify")}
              </Button>
            ) : (
              // Real, working action -- actually sends a real Supabase Auth
              // confirmation email, unlike the old fake "any code works"
              // modal. Only reachable if a real account somehow still has
              // an unconfirmed email (none do today).
              <Button size="sm" variant="outline" disabled={resending} onClick={resendConfirmationEmail}>
                {resending ? t("reputation.resending") : t("reputation.resendEmail")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <ShieldCheck size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("reputation.verifiedBadge")}</p>
              <p className="text-xs text-slate-500">
                {verifiedGolfer
                  ? t("reputation.verifiedBadgeActive")
                  : isDemo
                    ? t("reputation.verifiedBadgeInactive")
                    : t("reputation.verifiedBadgeInactiveReal")}
              </p>
            </div>
            {verifiedGolfer ? (
              <Badge tone="fairway" icon={<ShieldCheck size={11} />}>
                {t("reputation.active")}
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!canApplyVerifiedGolfer}
                onClick={() => {
                  requestVerifiedGolfer();
                  showToast(t("reputation.nowVerifiedToast"), "success");
                }}
              >
                {t("reputation.apply")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {isDemo && verifyChannel && (
        <VerifyStepModal
          channel={verifyChannel}
          target={verifyChannel === "phone" ? "(•••) •••-0142" : "you@example.com"}
          onClose={() => setVerifyChannel(null)}
          onVerified={() => {
            if (verifyChannel === "phone") setPhoneVerified(true);
            else setEmailVerified(true);
            showToast(`${verifyChannel === "phone" ? "Phone" : "Email"} verified.`, "success");
            setVerifyChannel(null);
          }}
        />
      )}
    </div>
  );
}
