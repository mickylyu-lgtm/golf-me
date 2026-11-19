import { boundsCenter, validBounds, type CourseBounds } from '../../supabase/functions/_shared/courseBounds.ts';
/** A typed course's coordinates can be the town, not the venue. Never use
 * round coordinates or name matching for imagery identity. */
export function roundBannerCourseId(courseId?: string): string | undefined {
  return courseId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId) ? courseId : undefined;
}
export function roundBannerSatellite(courseId: string | undefined, bounds: CourseBounds | null | undefined, simulator = false) {
  return !simulator && roundBannerCourseId(courseId) && validBounds(bounds) ? { ...boundsCenter(bounds), bounds } : null;
}
