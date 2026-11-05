import { useNavigate } from "react-router-dom";
import { Flag, MapPin, Navigation, Search } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useLocale } from "../../i18n/LocaleContext";
import { formatDistanceMiles } from "../../lib/geo";
import type { DisplayCourseResult } from "../../lib/useCourseSearch";
import { CourseMedia } from "./CourseMedia";
import { Button } from "../ui/Button";

// The body of a course page — title, the course's pictures (drone overview,
// real photo, AI preview; see CourseMedia), Host here, Directions, Find tee
// times — shared by the full page (pages/CourseDetail) and the course map's
// bottom sheet (pages/CourseMap), so both always show the same thing.
export function CourseDetailContent({ course }: { course: DisplayCourseResult }) {
  const { t } = useLocale();
  const navigate = useNavigate();

  const hasCoords = course.lat != null && course.lng != null;

  function openDirections() {
    const dest = hasCoords ? `${course.lat},${course.lng}` : [course.name, course.area].filter(Boolean).join(", ");
    const url =
      Capacitor.getPlatform() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent)
        ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&q=${encodeURIComponent(course.name)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function searchTeeTimes() {
    const q = [course.name, course.area, "tee times"].filter(Boolean).join(" ");
    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
  }

  function hostHere() {
    const params = new URLSearchParams({ course: course.name });
    if (course.id) params.set("courseId", course.id);
    if (hasCoords) {
      params.set("lat", String(course.lat));
      params.set("lng", String(course.lng));
    }
    navigate(`/golf-calls/new?${params.toString()}`);
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold text-slate-900">{course.name}</h1>
        {(course.area || course.distanceMiles != null) && (
          <p className="flex items-center gap-1 text-sm text-slate-500">
            <MapPin size={13} className="shrink-0" />
            {[course.area, course.distanceMiles != null ? formatDistanceMiles(course.distanceMiles) : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <CourseMedia course={course} />

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
    </>
  );
}
