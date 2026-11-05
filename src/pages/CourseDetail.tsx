import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { DisplayCourseResult } from "../lib/useCourseSearch";
import { CourseDetailContent } from "../components/courses/CourseDetailContent";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { goBack } from "../lib/goBack";

export interface CourseDetailState {
  course: DisplayCourseResult;
}

// Course page for any nearby course that isn't one of the hand-picked
// SUPPORTED_TEE_TIME_COURSES (those keep /tee-times/:id with their official
// booking link). Micky, 2026-10-23: every course should open a page with at
// least an image. GolfMe has no booking link for these, so the page never
// pretends to: Directions, a plain web search for tee times, and Host a
// Round with this course filled in. The body lives in CourseDetailContent,
// which the course map's bottom sheet shows too.
//
// The list hands the course over in navigation state (works for demo
// fixture courses, which have no id); a real course reloaded or opened by
// link is read back from public.courses by id.
export function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const { state } = useLocation() as { state: CourseDetailState | null };
  const { t } = useLocale();
  const { isDemo } = useAuth();
  const navigate = useNavigate();
  const [course, setCourse] = useState<DisplayCourseResult | null>(state?.course ?? null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (course || isDemo || !courseId) {
      if (!course) setMissing(true);
      return;
    }
    let cancelled = false;
    void Promise.resolve(
      supabase.from("courses").select("id, name, city, region, country, latitude, longitude").eq("id", courseId).maybeSingle(),
    ).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setMissing(true);
        return;
      }
      setCourse({
        id: data.id,
        name: data.name,
        area: [data.city, data.region].filter(Boolean).join(", ") || undefined,
        country: data.country ?? undefined,
        lat: data.latitude,
        lng: data.longitude,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [course, courseId, isDemo]);

  if (missing) return <Navigate to="/courses/nearby" replace />;
  if (!course) return <GolfMeLoader size="sm" />;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => goBack(navigate, "/courses/nearby")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>
      <CourseDetailContent course={course} />
    </div>
  );
}
