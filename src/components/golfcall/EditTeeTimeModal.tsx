import { useState } from "react";
import type { GolfCall } from "../../types";
import { useRealRounds } from "../../context/RealRoundsContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { CourseAutocomplete } from "./CourseAutocomplete";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { inputClass, labelClass } from "../ui/FormControls";

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

interface EditTeeTimeModalProps {
  call: GolfCall;
  onClose: () => void;
}

// Host-only, scoped to just course/date/time — the three fields booking
// proof is tied to (see edit_golf_call_tee_time()) — not a general-purpose
// round editor. Warns up front if proof is currently attached, since
// changing any of these three fields invalidates it server-side.
export function EditTeeTimeModal({ call, onClose }: EditTeeTimeModalProps) {
  const { editTeeTime } = useRealRounds();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [course, setCourse] = useState(call.course);
  const [courseId, setCourseId] = useState<string | null>(call.courseId ?? null);
  const [courseLat, setCourseLat] = useState<number | null>(null);
  const [courseLng, setCourseLng] = useState<number | null>(null);
  const [areaLabel, setAreaLabel] = useState(call.areaLabel);
  const [date, setDate] = useState(() => toDateInputValue(call.dateISO));
  const [timeLabel, setTimeLabel] = useState(call.timeLabel);
  const [saving, setSaving] = useState(false);

  const hasProof = call.teeTimeSource === "user_verified";
  const canSave = Boolean(course.trim() && date && timeLabel.trim());

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const { proofInvalidated } = await editTeeTime(call.id, {
        courseId,
        courseName: course.trim(),
        courseAreaLabel: areaLabel.trim(),
        courseLat,
        courseLng,
        dateISO: new Date(`${date}T12:00:00`).toISOString(),
        timeLabel: timeLabel.trim(),
      });
      showToast(proofInvalidated ? t("golfCallDetail.proofInvalidatedToast") : t("golfCallDetail.teeTimeUpdatedToast"), proofInvalidated ? "warning" : "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("golfCallDetail.bookingProofSaveError"), "warning");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("golfCallDetail.editTeeTime")}
      onClose={onClose}
      footer={
        <Button fullWidth disabled={!canSave || saving} onClick={handleSave}>
          {saving ? t("golfCallDetail.savingChanges") : t("common.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {hasProof && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">{t("golfCallDetail.editTeeTimeWarning")}</p>}
        <div>
          <label className={labelClass}>{t("host.step1Title")}</label>
          <CourseAutocomplete
            value={course}
            onChange={(v) => {
              setCourse(v);
              setCourseId(null);
              setCourseLat(null);
              setCourseLng(null);
            }}
            onPickKnownCourse={(pick) => {
              if (pick.area) setAreaLabel(pick.area);
              setCourseId(pick.id ?? null);
              setCourseLat(pick.lat ?? null);
              setCourseLng(pick.lng ?? null);
            }}
          />
        </div>
        <div>
          <label className={labelClass}>{t("host.generalArea")}</label>
          <input className={inputClass} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>{t("filters.chooseDate")}</label>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t("host.tellUsWhenTeeTime")}</label>
            <input className={inputClass} value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} placeholder="e.g. 10:00 AM" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
