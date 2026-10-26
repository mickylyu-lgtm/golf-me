import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Flag, MapPin, Navigation, Search } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useLocale } from "../i18n/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { formatDistanceMiles } from "../lib/geo";
import { courseSatelliteImageUrl } from "../lib/courseImagery";
import type { DisplayCourseResult } from "../lib/useCourseSearch";
import { CourseHero } from "../components/courses/CourseHero";
import { CourseImageModeToggle } from "../components/courses/CourseThumb";
import { useCourseImageMode, useCoursePhoto } from "../lib/coursePhotos";
import { Button } from "../components/ui/Button";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";

export interface CourseDetailState {
  course: DisplayCourseResult;
}

// Course page for any nearby course that isn't one of the hand-picked
// SUPPORTED_TEE_TIME_COURSES (those keep /tee-times/:id with their official
// booking link). Micky, 2026-10-23: every course should open a page with at
// least an image. GolfMe has no booking link for these, so the page never
// pretends to: Directions, a plain web search for tee times, and Host a
// Round with this course filled in.
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
  const imageMode = useCourseImageMode();
  const photo = useCoursePhoto(course?.name, course?.lat, course?.lng, imageMode === "photo");

  useEffect(() => {
    if (course || isDemo || !courseId) {
      if (!course) setMissing(true);
      return;
    }
    let cancelled = false;
    void Promise.resolve(
      supabase.from("courses").select("id, name, city, region, latitude, longitude").eq("id", courseId).maybeSingle(),
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

  const hasCoords = course.lat != null && course.lng != null;
  const satelliteUrl = courseSatelliteImageUrl(course.lat, course.lng) ?? undefined;
  // Photo mode shows the course's Wikimedia photo when it has one (credited
  // under the image), else the satellite view, same as the list rows.
  const shownPhoto = imageMode === "photo" ? photo : null;

  function openDirections() {
    if (!course) return;
    const dest = hasCoords ? `${course.lat},${course.lng}` : [course.name, course.area].filter(Boolean).join(", ");
    const url =
      Capacitor.getPlatform() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent)
        ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&q=${encodeURIComponent(course.name)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function searchTeeTimes() {
    if (!course) return;
    const q = [course.name, course.area, "tee times"].filter(Boolean).join(" ");
    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
  }

  function hostHere() {
    if (!course) return;
    const params = new URLSearchParams({ course: course.name });
    if (course.id) params.set("courseId", course.id);
    if (hasCoords) {
      params.set("lat", String(course.lat));
      params.set("lng", String(course.lng));
    }
    navigate(`/golf-calls/new?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{course.name}</h1>
        {(course.area || course.distanceMiles != null) && (
          <p className="flex items-center gap-1 text-sm text-slate-500">
            <MapPin size={13} className="shrink-0" />
            {[course.area, course.distanceMiles != null ? formatDistanceMiles(course.distanceMiles) : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <CourseImageModeToggle />
        </div>
        {shownPhoto ? (
          <CourseHero
            key={shownPhoto.url}
            courseName={course.name}
            city={course.area ?? ""}
            state=""
            imageUrl={shownPhoto.url}
            imageCredit={shownPhoto.credit}
            imageCreditUrl={shownPhoto.pageUrl}
          />
        ) : (
          <CourseHero key="satellite" courseName={course.name} city={course.area ?? ""} state="" imageUrl={satelliteUrl} attributionInImage />
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Button fullWidth icon={<Flag size={15} />} onClick={hostHere}>
          {t("coursePage.hostHere")}
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" fullWidth icon={<Navigation size={15} />} onClick={openDirections}>
            {t("coursePage.directions")}
          </Button>
          <Button variant="secondary" fullWidth icon={<Search size={15} />} onClick={searchTeeTimes}>
            {t("coursePage.findTeeTimes")}
          </Button>
        </div>
        <p className="text-center text-xs text-slate-400">{t("coursePage.teeTimesNote")}</p>
      </div>
    </div>
  );
}
