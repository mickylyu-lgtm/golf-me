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
import { originatingRoundPath } from "../lib/roundCourseLink";

export interface CourseDetailState {
  course?: DisplayCourseResult;
  fromRoundId?: string;
}

const COURSE_DETAIL_TIMEOUT_MS = 12_000;

// Course page for every nearby course. Micky, 2026-10-23: every course should open a page with at
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
  const { state, key } = useLocation() as { state: CourseDetailState | null; key: string };
  const { isDemo } = useAuth();
  // React Router can reuse the same route when the ID or history entry changes.
  // Never let the old title/actions or its in-flight result follow that navigation.
  return <CourseDetailPage key={JSON.stringify([key, courseId, isDemo])} courseId={courseId} state={state} isDemo={isDemo} />;
}

function CourseDetailPage({ courseId, state, isDemo }: { courseId?: string; state: CourseDetailState | null; isDemo: boolean }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const handedCourse = state?.course;
  const [course, setCourse] = useState<DisplayCourseResult | null>(
    handedCourse && (handedCourse.id ?? "demo") === courseId ? handedCourse : null,
  );
  const [status, setStatus] = useState<"loading" | "missing" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (course) return;
    if (isDemo || !courseId || courseId === "demo") {
      setStatus("missing");
      return;
    }
    const controller = new AbortController();
    const expire = () => {
      controller.abort();
      setStatus("failed");
    };
    const deadline = window.setTimeout(expire, COURSE_DETAIL_TIMEOUT_MS);
    void (async () => {
      try {
        const { data, error } = await supabase.from("courses").select("id, name, city, region, country, latitude, longitude")
          .eq("id", courseId).abortSignal(controller.signal).maybeSingle();
        if (controller.signal.aborted) return;
        if (error) setStatus("failed");
        else if (!data) setStatus("missing");
        else setCourse({
          id: data.id,
          name: data.name,
          area: [data.city, data.region].filter(Boolean).join(", ") || undefined,
          country: data.country ?? undefined,
          lat: data.latitude,
          lng: data.longitude,
        });
      } catch {
        if (!controller.signal.aborted) setStatus("failed");
      } finally {
        window.clearTimeout(deadline);
      }
    })();
    return () => {
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [course, courseId, isDemo, attempt]);

  const missing = status === "missing";
  const roundPath = originatingRoundPath(state?.fromRoundId);
  if (missing && !roundPath) return <Navigate to="/courses/nearby" replace />;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => goBack(navigate, roundPath ?? "/courses/nearby")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>
      {course ? <CourseDetailContent course={course} /> : status === "loading" ? <GolfMeLoader size="sm" /> : (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm text-slate-500">{t("coursePage.unavailable")}</p>
          {status === "failed" && <button type="button" className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-fairway-800"
            onClick={() => { setStatus("loading"); setAttempt((n) => n + 1); }}>{t("loading.retry")}</button>}
        </div>
      )}
    </div>
  );
}
