import { ShieldCheck } from "lucide-react";
import type { GolfCall } from "../../types";
import { Modal } from "../ui/Modal";
import { useLocale } from "../../i18n/LocaleContext";
import { formatRelativeTime } from "../../lib/format";

// Public explanation shown to ANY viewer who taps the badge — only uses
// golf_calls' own public-safe columns (bookingSource/verificationCreatedAt).
// Never fetches or shows the raw proof file/booking reference — those stay
// host-only, see useBookingProof.ts / the booking_proofs RLS policy.
export function BookingProofExplainer({ call, onClose }: { call: GolfCall; onClose: () => void }) {
  const { t, locale } = useLocale();
  return (
    <Modal title={t("golfCallDetail.bookingProofExplainerTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-xl bg-fairway-50 p-3 text-sm font-semibold text-fairway-700">
          <ShieldCheck size={16} /> {t("golfCallDetail.bookingProofBadge")}
        </div>
        <p className="text-sm text-slate-600">{t("golfCallDetail.bookingProofExplainerBody")}</p>
        <dl className="flex flex-col gap-2 text-sm">
          {call.bookingSource && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">{t("golfCallDetail.bookingProofSourceLabel")}</dt>
              <dd className="font-semibold text-slate-700">{call.bookingSource}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">{t("golfCallDetail.bookingProofVerifiedByLabel")}</dt>
            <dd className="font-semibold text-slate-700">{t("golfCallDetail.bookingProofVerifiedByValue")}</dd>
          </div>
          {call.verificationCreatedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">{t("golfCallDetail.bookingProofAddedLabel")}</dt>
              <dd className="font-semibold text-slate-700">{formatRelativeTime(call.verificationCreatedAt, locale, t)}</dd>
            </div>
          )}
        </dl>
        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
          {t("golfCallDetail.bookingProofNotIndependentlyConfirmed")}
        </p>
      </div>
    </Modal>
  );
}
