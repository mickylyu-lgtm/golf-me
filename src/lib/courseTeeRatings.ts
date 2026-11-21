import { supabase } from "./supabase";
import type { CourseTeeRatings } from "../../supabase/functions/course-tee-ratings/contract";

export type { CourseTeeRatings, CourseTeeRating, TeeRatingSet } from "../../supabase/functions/course-tee-ratings/contract";

export async function loadCourseTeeRatings(courseId: string): Promise<CourseTeeRatings | null> {
  const { data, error } = await supabase.functions.invoke<CourseTeeRatings | null>("course-tee-ratings", {
    body: { courseId },
  });
  if (error) throw new Error("course_tee_ratings_unavailable");
  if (!Array.isArray(data?.tees) || !data.tees.length) return null;
  if (!data.source || typeof data.source.url !== "string" || typeof data.source.reviewedOn !== "string") {
    throw new Error("course_tee_ratings_unavailable");
  }
  return data;
}
