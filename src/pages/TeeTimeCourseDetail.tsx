import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, ExternalLink, MapPin, RotateCcw } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { SUPPORTED_TEE_TIME_COURSES } from "../services/teeTimes/types";
import { useTeeTimes } from "../lib/useTeeTimes";
import { formatRelativeTime } from "../lib/format";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { inputClass, labelClass } from "../components/ui/FormControls";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TeeTimeCourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayISO());

  const course = useMemo(() => SUPPORTED_TEE_TIME_COURSES.find((c) => c.id === courseId), [courseId]);
  const { data, loading, error, retry } = useTeeTimes(course?.id ?? null, date);

  if (!course) return <Navigate to="/tee-times" replace />;

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* Real (history-based) back, same as the Tee Times list page's own
          back button — one tap here lands on that list, one more tap from
          there lands on Play, matching how the user actually arrived. */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{course.name}</h1>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          <MapPin size={13} className="shrink-0" />
          {course.city}, {course.state} · {t("teeTimes.holesLabel", { holes: course.holes })}
        </p>
      </div>

      <div>
        <label className={labelClass}>{t("teeTimes.selectDate")}</label>
        <input type="date" min={todayISO()} className={`${inputClass} mt-2 w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {loading && <GolfMeLoader size="sm" message={t("teeTimes.loading")} />}

      {!loading && error && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
          <p className="text-xs text-red-700">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100"
          >
            <RotateCcw size={12} /> {t("teeTimes.retry")}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.teeTimes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fairway-700">
                <CalendarClock size={12} /> {t("teeTimes.liveInsideGolfMe")}
              </p>
              {data.teeTimes.map((slot) => (
                <a
                  key={slot.id}
                  href={slot.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 transition-colors duration-150 hover:border-fairway-300"
                >
                  <span className="font-semibold text-slate-800">{slot.time}</span>
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    {slot.price != null && <span>${slot.price}</span>}
                    {slot.availableSpots != null && <span>{slot.availableSpots}</span>}
                    <ExternalLink size={14} />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CalendarClock size={20} />}
              title={t("teeTimes.emptyTitle")}
              description={t("teeTimes.emptyDescription")}
              action={
                <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(data.bookingUrl, "_blank", "noopener,noreferrer")}>
                  {t("teeTimes.viewLiveTeeTimes")}
                </Button>
              }
            />
          )}

          <p className="text-center text-[11px] text-slate-400">
            {t("teeTimes.checkOnCourseWebsite")} · {t("teeTimes.lastUpdated", { time: formatRelativeTime(data.lastUpdated, locale, t) })}
          </p>
        </>
      )}
    </div>
  );
}
