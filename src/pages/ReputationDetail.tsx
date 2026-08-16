import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Mail, Phone, ShieldCheck } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ReputationRow } from "../components/golfer/ReputationRow";
import { CredibilityBadge } from "../components/golfer/CredibilityBadge";
import { VerifyStepModal } from "../components/profile/VerifyStepModal";
import { computeCredibility, computeHandicapConfidence } from "../lib/credibility";
import { useCredibilityStats } from "../lib/useCredibility";

export function ReputationDetail() {
  const { currentUser, reviewsAbout, setPhoneVerified, setEmailVerified, requestVerifiedGolfer } = useData();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email" | null>(null);

  // Real accounts: reputation/handicap-confidence come from a live server
  // aggregate (get_credibility_stats), never raw review rows — those stay
  // reviewer-only. Demo mode: falls straight through to the existing
  // reviews-based computation, unchanged.
  const { reputation: realReputation, handicapConfidence: realHandicapConfidence } = useCredibilityStats(currentUser.id, currentUser.reputation);
  const enrichedUser = { ...currentUser, reputation: realReputation };
  const myReviews = reviewsAbout(currentUser.id);
  const credibility = computeCredibility(enrichedUser, myReviews);
  const handicapConfidence = realHandicapConfidence ?? computeHandicapConfidence(myReviews);
  const canApplyVerifiedGolfer =
    currentUser.verification.phoneVerified && currentUser.verification.emailVerified && !currentUser.verification.verifiedGolfer;

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
        <div className="mt-2">
          <CredibilityBadge tier={credibility.tier} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4">
        <ReputationRow golfer={currentUser} />
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
            {currentUser.verification.phoneVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                {t("reputation.verified")}
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("phone")}>
                {t("reputation.verify")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <Mail size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("reputation.emailAddress")}</p>
              <p className="text-xs text-slate-500">{t("reputation.neverShown")}</p>
            </div>
            {currentUser.verification.emailVerified ? (
              <Badge tone="fairway" icon={<Check size={11} />}>
                {t("reputation.verified")}
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setVerifyChannel("email")}>
                {t("reputation.verify")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3">
            <ShieldCheck size={16} className="text-slate-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("reputation.verifiedBadge")}</p>
              <p className="text-xs text-slate-500">
                {currentUser.verification.verifiedGolfer ? t("reputation.verifiedBadgeActive") : t("reputation.verifiedBadgeInactive")}
              </p>
            </div>
            {currentUser.verification.verifiedGolfer ? (
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

      {verifyChannel && (
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
