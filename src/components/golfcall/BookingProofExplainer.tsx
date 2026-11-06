import type { GolfCall } from "../../types";
import { Modal } from "../ui/Modal";
import { useLocale } from "../../i18n/LocaleContext";
import { formatDate, formatRelativeTime } from "../../lib/format";
import { bookingSourceKey, bookingStatusView } from "../../lib/bookingStatus";
import { TeeTimeTrustBadge } from "./TeeTimeTrustBadge";

// Public explanation shown to ANY viewer who taps the booking chip. Only
// golf_calls' own public-safe columns. Never fetches or shows the evidence
// file, which stays with the host and reviewers (booking_evidence RLS,
// private booking-proofs bucket). The stored source is shown only when it is
// one of the five picker values; anything else reads "Host reported".
export function BookingProofExplainer({ call, onClose }: { call: GolfCall; onClose: () => void }) {
  const { t, locale } = useLocale();
  const view = bookingStatusView(call);
  const booked = view.state === "booked_host_reported";

  let body: string;
  if (view.evidence === "reviewed" && view.reviewedAt) body = t("booking.evidenceReviewed", { date: formatDate(view.reviewedAt, locale, t) });
  else if (view.evidence === "needs_correction") body = t("booking.evidenceNeedsCorrection");
  else if (view.evidence === "submitted" || (view.model === "legacy" && booked)) body = t("golfCallDetail.bookingProofExplainerBody");
  else if (booked) body = t("booking.explainBookedNoEvidence");
  else body = t(view.labelKey);

  return (
    <Modal title={t("golfCallDetail.bookingProofExplainerTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TeeTimeTrustBadge call={call} />
        <p className="text-sm leading-relaxed text-slate-600">{body}</p>
        {view.partySize !== undefined && <p className="text-sm font-semibold text-slate-700">{t("booking.partySize", { count: view.partySize })}</p>}
        <dl className="flex flex-col gap-2 text-sm">
          {booked && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">{t("golfCallDetail.bookingProofSourceLabel")}</dt>
              <dd className="font-semibold text-slate-700">{t(bookingSourceKey(call.bookingSource))}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">{t("golfCallDetail.bookingProofVerifiedByLabel")}</dt>
            <dd className="font-semibold text-slate-700">{t("golfCallDetail.bookingProofVerifiedByValue")}</dd>
          </div>
          {booked && call.verificationCreatedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">{t("golfCallDetail.bookingProofAddedLabel")}</dt>
              <dd className="font-semibold text-slate-700">{formatRelativeTime(call.verificationCreatedAt, locale, t)}</dd>
            </div>
          )}
        </dl>
        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{t("booking.availabilityNotConnected")}</p>
      </div>
    </Modal>
  );
}
