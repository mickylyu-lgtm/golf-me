import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { SUPPORTED_TEE_TIME_COURSES } from "../services/teeTimes/types";
import { CLICKABLE_CARD_CLASS } from "../components/ui/cardStyles";

// Deliberately restricted to SUPPORTED_TEE_TIME_COURSES (2 courses today,
// each hand-verified — see src/services/teeTimes) rather than the general
// course-search system the rest of GolfMe uses. Adding a course here means
// adding it to that list + a provider, not touching this page.
export function TeeTimes() {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("teeTimes.title")}</h1>
        <p className="text-sm text-slate-500">{t("teeTimes.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-3">
        {SUPPORTED_TEE_TIME_COURSES.map((course) => (
          <button
            key={course.id}
            onClick={() => navigate(`/tee-times/${course.id}`)}
            className={`flex w-full items-center gap-3 p-4 text-left ${CLICKABLE_CARD_CLASS}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-slate-900">{course.name}</span>
              <span className="flex items-center gap-1 text-sm text-slate-500">
                <MapPin size={13} className="shrink-0" />
                {course.city}, {course.state} · {t("teeTimes.holesLabel", { holes: course.holes })}
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  );
}
