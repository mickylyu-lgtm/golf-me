import type { NavigateFunction } from "react-router-dom";
import type { DisplayCourseResult } from "./useCourseSearch";
import type { CourseDetailState } from "../pages/CourseDetail";

// One place that decides where tapping a course goes: the general course
// page, handed over in navigation state so demo fixture courses (no id)
// work too.
export function openCourse(navigate: NavigateFunction, course: DisplayCourseResult): void {
  const state: CourseDetailState = { course };
  navigate(`/courses/${encodeURIComponent(course.id ?? "demo")}`, { state });
}
