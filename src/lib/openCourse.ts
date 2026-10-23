import type { NavigateFunction } from "react-router-dom";
import type { DisplayCourseResult } from "./useCourseSearch";
import type { CourseDetailState } from "../pages/CourseDetail";

// One place that decides where tapping a course goes: a hand-picked
// SUPPORTED_TEE_TIME_COURSES entry keeps its tee-time page (official booking
// link); any other course opens the general course page, handed over in
// navigation state so demo fixture courses (no id) work too.
export function openCourse(navigate: NavigateFunction, course: DisplayCourseResult, supportedTeeTimeCourseId?: string): void {
  if (supportedTeeTimeCourseId) {
    navigate(`/tee-times/${supportedTeeTimeCourseId}`);
    return;
  }
  const state: CourseDetailState = { course };
  navigate(`/courses/${encodeURIComponent(course.id ?? "demo")}`, { state });
}
