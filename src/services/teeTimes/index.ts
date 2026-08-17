import { skywayProvider } from "./providers/skyway";
import { dykerBeachProvider } from "./providers/dykerBeach";
import type { TeeTimeProvider } from "./types";

export * from "./types";

// Adding a third course later is: add it to SUPPORTED_TEE_TIME_COURSES
// (types.ts), write providers/<course>.ts implementing TeeTimeProvider, and
// register it here — nothing else in the app needs to change.
const PROVIDERS: Record<string, TeeTimeProvider> = {
  skyway: skywayProvider,
  "dyker-beach": dykerBeachProvider,
};

export function getProviderForCourse(courseId: string): TeeTimeProvider | null {
  return PROVIDERS[courseId] ?? null;
}
