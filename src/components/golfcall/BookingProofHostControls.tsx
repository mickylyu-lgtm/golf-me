import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { useToast } from "../../context/ToastContext";

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;
import { useBookingProof } from "../../lib/useBookingProof";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { inputClass, labelClass } from "../ui/FormControls";

const BOOKING_SOURCES = ["Course Website", "GolfNow", "Lightspeed / Chronogolf", "Phone Reservation", "Other"] as const;

function bookingSourceLabel(source: string, t: TFn): string {
  switch (source) {
    case "Course Website":
      return t("golfCallDetail.bookingSourceCourseWebsite");
    case "GolfNow":
      return t("golfCallDetail.bookingSourceGolfNow");
    case "Lightspeed / Chronogolf":
      return t("golfCallDetail.bookingSourceLightspeed");
    case "Phone Reservation":
      return t("golfCallDetail.bookingSourcePhone");
    default:
      return t("golfCallDetail.bookingSourceOther");
  }
}

// Host-only add/replace/remove for a round's booking proof — never rendered
// for anyone but the round's host (GolfCallDetail gates on isHost before
// mounting this), and every mutation is re-checked server-side by
// attach_booking_proof()/remove_booking_proof() regardless.
export function BookingProofHostControls({ golfCallId }: { golfCallId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const { proof, attach, remove } = useBookingProof(golfCallId);
  const [formOpen, setFormOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string>(BOOKING_SOURCES[0]);
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      await attach(file, source, reference);
      showToast(t("golfCallDetail.bookingProofAddedToast"), "success");
      setFormOpen(false);
      setFile(null);
      setReference("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("golfCallDetail.bookingProofSaveError"), "warning");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    try {
      await remove();
      showToast(t("golfCallDetail.bookingProofRemovedToast"), "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("golfCallDetail.bookingProofSaveError"), "warning");
    } finally {
      setRemoveConfirmOpen(false);
    }
  }

  return (
    <>
      {proof ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
            {t("golfCallDetail.replaceBookingProof")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRemoveConfirmOpen(true)}>
            {t("golfCallDetail.removeBookingProof")}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" icon={<ShieldCheck size={14} />} onClick={() => setFormOpen(true)}>
          {t("golfCallDetail.addBookingProof")}
        </Button>
      )}

      {formOpen && (
        <Modal
          title={proof ? t("golfCallDetail.replaceBookingProof") : t("golfCallDetail.addBookingProof")}
          onClose={() => setFormOpen(false)}
          footer={
            <Button fullWidth disabled={!file || submitting} onClick={handleSubmit}>
              {submitting ? t("golfCallDetail.uploading") : t("golfCallDetail.saveBookingProof")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">{t("golfCallDetail.sensitiveInfoWarning")}</p>
            <div>
              <label className={labelClass}>{t("golfCallDetail.uploadImageOrPdf")}</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-fairway-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-fairway-700"
              />
              {file && <p className="mt-1 truncate text-xs text-slate-500">{file.name}</p>}
            </div>
            <div>
              <label className={labelClass}>{t("golfCallDetail.bookingSourceLabel")}</label>
              <div className="flex flex-wrap gap-1.5">
                {BOOKING_SOURCES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      source === s ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-fairway-300"
                    }`}
                  >
                    {bookingSourceLabel(s, t)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>{t("golfCallDetail.bookingReferenceLabel")}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
            </div>
          </div>
        </Modal>
      )}

      {removeConfirmOpen && (
        <ConfirmDialog
          title={t("golfCallDetail.removeBookingProof")}
          message={t("golfCallDetail.removeBookingProofConfirm")}
          confirmLabel={t("golfCallDetail.removeBookingProof")}
          danger
          onConfirm={handleRemove}
          onCancel={() => setRemoveConfirmOpen(false)}
        />
      )}
    </>
  );
}
