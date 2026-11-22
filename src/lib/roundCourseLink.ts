import { isShareableRoundId } from "./shareLinks.ts";

/** Persisted rounds carry a courses.id foreign key. Free text and demo IDs
 * never resolve to a detail page, even if their display name matches. */
export function roundCourseDestination(courseId: string | undefined, isDemo: boolean): string | undefined {
  return !isDemo && courseId && isShareableRoundId(courseId) ? `/courses/${courseId}` : undefined;
}

/** Navigation state isn't trusted as a URL. Only an internal round UUID can
 * change the cold Back fallback; ordinary navigation pops the history entry. */
export function originatingRoundPath(roundId: unknown): string | undefined {
  return typeof roundId === "string" && isShareableRoundId(roundId) ? `/golf-calls/${roundId}` : undefined;
}
