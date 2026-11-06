import { useEffect, useState } from "react";
import { ClipboardList, Paperclip } from "lucide-react";
import type { GolfCall } from "../../types";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { inputClass, labelClass } from "../ui/FormControls";
import {
  BOOKING_SOURCES,
  bookingSourceKey,
  bookingStatusView,
  canSubmitEvidence,
  HOST_BOOKING_CHOICES,
  HOST_BOOKING_CHOICE_KEYS,
  type HostBookingChoice,
} from "../../lib/bookingStatus";
import { BookingActionError, useBookingEvidence } from "../../lib/useBookingEvidence";

const REASON_KEYS: Record<string, TranslationKey> = {
  illegible: "booking.reasonIllegible",
  course_mismatch: "booking.reasonCourse",
  date_mismatch: "booking.reasonDate",
  time_mismatch: "booking.reasonTime",
  party_size_mismatch: "booking.reasonPartySize",
  not_a_booking: "booking.reasonNotBooking",
};

function choiceFor(state: ReturnType<typeof bookingStatusView>["state"]): HostBookingChoice | null {
  switch (state) {
    case "booked_host_reported":
      return "booked";
    case "not_provided":
      return null;
    default:
      return state;
  }
}

// Host-only booking panel on the round page (server model, migration
// 20261107150000). The host says where the booking stands and may add one
// screenshot as evidence; nothing here can mark anything reviewed (only a
// reviewer, server-side). Mounted only for the host of an upcoming round,
// and every call is re-checked by the server anyway.
export function BookingHostPanel({ call }: { call: GolfCall }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const view = bookingStatusView(call);
  const { mine, step, saving, setStatus, submit, withdraw, viewUrl } = useBookingEvidence(call);

  const current = choiceFor(view.state);
  const [choice, setChoice] = useState<HostBookingChoice | null>(current);
  const [party, setParty] = useState<number | null>(call.bookingPartySize ?? null);
  const [via, setVia] = useState<string>(BOOKING_SOURCES.includes(call.bookingSource as (typeof BOOKING_SOURCES)[number]) ? (call.bookingSource as string) : BOOKING_SOURCES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState<TranslationKey | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  // Follow server changes (another device, a tee-time edit marking "changed").
  useEffect(() => {
    setChoice(current);
    setParty(call.bookingPartySize ?? null);
  }, [current, call.bookingPartySize, call.bookingVersion]);

  const dirty =
    choice !== null &&
    (choice !== current || (choice === "booked" && (party !== (call.bookingPartySize ?? null) || via !== (call.bookingSource ?? ""))));

  async function saveStatus() {
    if (!choice || !dirty) return;
    try {
      await setStatus(choice, party, via);
      showToast(t("booking.statusSavedToast"), "success");
    } catch (err) {
      showToast(t(err instanceof BookingActionError ? err.key : "golfCallDetail.bookingProofSaveError"), "warning");
    }
  }

  async function upload() {
    if (!file) return;
    setFailed(null);
    try {
      await submit(file);
      setFile(null);
      showToast(t("booking.evidenceUploadedToast"), "success");
    } catch (err) {
      const key = err instanceof BookingActionError ? err.key : "golfCallDetail.bookingProofSaveError";
      setFailed(key);
    }
  }

  async function remove() {
    try {
      await withdraw();
      showToast(t("booking.evidenceRemovedToast"), "info");
    } catch (err) {
      showToast(t(err instanceof BookingActionError ? err.key : "golfCallDetail.bookingProofSaveError"), "warning");
    } finally {
      setRemoveOpen(false);
    }
  }

  async function openFile() {
    const url = await viewUrl();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else showToast(t("golfCallDetail.bookingProofSaveError"), "warning");
  }

  const stepLabel: Record<typeof step, TranslationKey | null> = {
    idle: null,
    preparing: "booking.stepPreparing",
    uploading: "booking.stepUploading",
    saving: "booking.stepSaving",
  };
  const busyKey = stepLabel[step];
  const outcomeKey =
    mine?.reviewOutcome === "needs_correction" ? "booking.reviewNeedsCorrection" : mine?.status === "rejected" ? "booking.reviewRejected" : null;
  const reason = mine?.reviewReasonCode ? t(REASON_KEYS[mine.reviewReasonCode] ?? "booking.reasonOther") : t("booking.reasonOther");

  return (
    <section aria-labelledby="booking-panel-title" className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <h2 id="booking-panel-title" className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <ClipboardList size={14} aria-hidden /> {t("booking.panelTitle")}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("booking.panelHint")}</p>
      </div>

      <fieldset>
        <legend className={labelClass}>{t("booking.label")}</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {HOST_BOOKING_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={choice === c}
              onClick={() => setChoice(c)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                choice === c ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
              }`}
            >
              {t(HOST_BOOKING_CHOICE_KEYS[c])}
            </button>
          ))}
        </div>
      </fieldset>

      {choice === "booked" && (
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass} htmlFor="booking-party-size">
              {t("booking.partySizeLabel")}
            </label>
            <select
              id="booking-party-size"
              className={inputClass}
              value={party ?? ""}
              onChange={(e) => setParty(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">{t("booking.choiceNotSaying")}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className={labelClass}>{t("golfCallDetail.bookingSourceLabel")}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {BOOKING_SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={via === s}
                  onClick={() => setVia(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    via === s ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
                  }`}
                >
                  {t(bookingSourceKey(s))}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <Button size="sm" disabled={!dirty || saving} aria-busy={saving || undefined} onClick={() => void saveStatus()} className="self-start">
        {saving ? t("golfCallDetail.savingChanges") : t("booking.saveStatus")}
      </Button>

      <div className="border-t border-slate-100 pt-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Paperclip size={14} aria-hidden /> {t("booking.evidenceTitle")}
        </p>
        {!canSubmitEvidence(view) || current !== "booked" ? (
          <p className="mt-1 text-xs text-slate-500">{t("booking.evidenceNeedsBooked")}</p>
        ) : (
          <div className="mt-1 flex flex-col gap-2.5">
            <p className="text-xs text-slate-500">{t("booking.evidenceHint")}</p>
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-700">{t("golfCallDetail.sensitiveInfoWarning")}</p>
            {view.evidence === "submitted" && <p className="text-xs font-medium text-slate-700">{t("booking.evidenceSubmitted")}</p>}
            {view.evidence === "reviewed" && <p className="text-xs font-medium text-fairway-800">{t("booking.statusReviewed")}</p>}
            {outcomeKey && (
              <p className="text-xs font-medium text-slate-700" role="status">
                {t(outcomeKey, { reason })}
              </p>
            )}
            {mine && mine.status !== "rejected" && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void openFile()}>
                  {t("booking.viewEvidence")}
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => setRemoveOpen(true)}>
                  {t("booking.removeEvidence")}
                </Button>
              </div>
            )}
            <label className={labelClass} htmlFor="booking-evidence-file">
              {mine && mine.status !== "rejected" ? t("booking.replaceEvidence") : t("golfCallDetail.uploadImageOrPdf")}
            </label>
            <input
              id="booking-evidence-file"
              type="file"
              accept="image/*"
              disabled={step !== "idle"}
              onChange={(e) => {
                setFailed(null);
                setFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-fairway-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-fairway-700"
            />
            {failed && (
              <p className="text-xs font-medium text-red-600" role="alert">
                {t(failed)}
              </p>
            )}
            <Button
              size="sm"
              disabled={!file || step !== "idle"}
              aria-busy={step !== "idle" || undefined}
              onClick={() => void upload()}
              className="self-start"
            >
              {busyKey ? t(busyKey) : failed ? t("booking.retry") : mine && mine.status !== "rejected" ? t("booking.replaceEvidence") : t("booking.uploadEvidence")}
            </Button>
          </div>
        )}
      </div>

      {removeOpen && (
        <ConfirmDialog
          title={t("booking.removeEvidence")}
          message={t("booking.removeEvidenceConfirm")}
          confirmLabel={t("booking.removeEvidence")}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setRemoveOpen(false)}
        />
      )}
    </section>
  );
}
