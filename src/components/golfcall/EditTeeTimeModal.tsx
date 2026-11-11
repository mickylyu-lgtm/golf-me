import { useState } from "react";
import type { GolfCall } from "../../types";
import { useRealRounds } from "../../context/RealRoundsContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { CourseAutocomplete } from "./CourseAutocomplete";
import { LocationPicker } from "../location/LocationPicker";
import { hasRoundCourseLocation } from "../../lib/roundCourseLocation";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { inputClass, labelClass } from "../ui/FormControls";
import { isPastRoundStart, localDateInputValue } from "../../lib/golfCall";
import { isObjectionableContentError } from "../../lib/objectionableContent";

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
  // Start from the round's stored coordinates: the RPC writes whatever is
  // sent, so starting at null wiped them on a time-only edit and the round
  // dropped out of every radius search.
  const [courseLat, setCourseLat] = useState<number | null>(call.courseLat ?? null);
  const [courseLng, setCourseLng] = useState<number | null>(call.courseLng ?? null);
  const [areaLabel, setAreaLabel] = useState(call.areaLabel);
  const [date, setDate] = useState(() => toDateInputValue(call.dateISO));
  const [timeLabel, setTimeLabel] = useState(call.timeLabel);
  const [saving, setSaving] = useState(false);
  const [townPickerOpen, setTownPickerOpen] = useState(false);
  const [courseTownLabel, setCourseTownLabel] = useState<string | null>(null);

  const hasProof = call.teeTimeSource === "user_verified";
  // Server model: a booked round's booking becomes "changed" on a real edit.
  const marksChanged = call.bookingStatus === "booked";
  // Moving a round into the past would make it instantly unjoinable.
  const startsInPast = isPastRoundStart(date, timeLabel);
  const courseHasLocation = hasRoundCourseLocation(courseLat, courseLng);
  const canSave = Boolean(course.trim() && areaLabel.trim() && date && timeLabel.trim()) && courseHasLocation && !startsInPast;

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
      showToast(
        isObjectionableContentError(err)
          ? t("moderation.objectionableContent")
          : err instanceof Error
            ? err.message
            : t("golfCallDetail.bookingProofSaveError"),
        "warning",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("golfCallDetail.editTeeTime")}
      onClose={onClose}
      keyboardAware
      footer={
        <Button fullWidth disabled={!canSave || saving} onClick={handleSave}>
          {saving ? t("golfCallDetail.savingChanges") : t("common.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {marksChanged ? (
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">{t("booking.editChangesBooking")}</p>
        ) : (
          hasProof && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">{t("golfCallDetail.editTeeTimeWarning")}</p>
        )}
        <div>
          <label className={labelClass}>{t("host.step1Title")}</label>
          <CourseAutocomplete
            value={course}
            onChange={(v) => {
              setCourse(v);
              setCourseId(null);
              if (!courseTownLabel || !v.trim()) {
                setCourseLat(null);
                setCourseLng(null);
              }
              if (!v.trim()) setCourseTownLabel(null);
            }}
            onPickKnownCourse={(pick) => {
              setCourseTownLabel(null);
              if (pick.area) setAreaLabel(pick.area);
              setCourseId(pick.id ?? null);
              setCourseLat(pick.lat ?? null);
              setCourseLng(pick.lng ?? null);
            }}
          />
          {course.trim() && !courseHasLocation && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl bg-amber-50 p-3">
              <p className="text-xs text-amber-800">{t("host.courseTownPrompt")}</p>
              <Button size="sm" variant="outline" onClick={() => setTownPickerOpen(true)}>{t("host.chooseCourseTown")}</Button>
            </div>
          )}
          {courseTownLabel && (
            <button className="mt-2 text-xs font-semibold text-fairway-700" onClick={() => setTownPickerOpen(true)}>{courseTownLabel}</button>
          )}
        </div>
        <div>
          <label className={labelClass}>{t("host.generalArea")}</label>
          <input
            className={inputClass}
            value={areaLabel}
            onChange={(e) => setAreaLabel(e.target.value)}
            maxLength={80}
            autoCapitalize="words"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>{t("filters.chooseDate")}</label>
            <input type="date" className={inputClass} value={date} min={localDateInputValue()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t("host.tellUsWhenTeeTime")}</label>
            <input
              className={inputClass}
              value={timeLabel}
              onChange={(e) => setTimeLabel(e.target.value)}
              placeholder={t("host.teeTimePlaceholder")}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="done"
            />
          </div>
        </div>
        {startsInPast && <p className="-mt-2 text-xs font-medium text-red-600">{t("host.pastStartError")}</p>}
        {townPickerOpen && (
          <LocationPicker title={t("host.chooseCourseTown")} onClose={() => setTownPickerOpen(false)} onSelect={(area) => {
            if (!area.coords || !hasRoundCourseLocation(area.coords.lat, area.coords.lng)) {
              showToast(t("autoMatch.locationNoCoords"), "warning");
              return;
            }
            setCourseLat(area.coords.lat);
            setCourseLng(area.coords.lng);
            setAreaLabel(area.label);
            setCourseTownLabel(area.label);
            setTownPickerOpen(false);
          }} />
        )}
      </div>
    </Modal>
  );
}
