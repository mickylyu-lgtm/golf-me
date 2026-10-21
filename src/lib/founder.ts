import type { GeoPoint } from "./geo";
import { haversineMiles } from "./geo";
import type { FoundingCohortStatus } from "./useFoundingCohortStatus";

// The one official GolfMe founder account — Micky's real, existing account
// (same one used for /admin tools), not a separate system persona: replies
// from new users land in the inbox he already checks. Stable id, never
// regenerated; mirrored in the notify_founder_welcome() DB trigger.
export const FOUNDER_USER_ID = "11be6983-7cd6-434d-bb52-6bfaf1d6e309";

export function isFounder(golferId: string): boolean {
  return golferId === FOUNDER_USER_ID;
}

// Founding Golfer numbers display zero-padded: 37 -> "#037".
export function formatFoundingNumber(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

// Display-only mirror of the server's Founding zone (private.in_founding_zone
// in 20261006120000: 30 miles of Midtown). Decides whether onboarding shows
// the NYC spots line; the server alone decides who is awarded a number.
const FOUNDING_ZONE_CENTER: GeoPoint = { lat: 40.7549, lng: -73.984 };
const FOUNDING_ZONE_RADIUS_MILES = 30;

export function isInFoundingZone(coords: GeoPoint | undefined): boolean {
  return coords != null && haversineMiles(coords, FOUNDING_ZONE_CENTER) <= FOUNDING_ZONE_RADIUS_MILES;
}

// True when there is a live, authoritative count worth showing: spots left
// in an open cohort, or every spot claimed. False while loading, on error,
// before the cohort opens, or after an admin closed it early -- callers then
// show no count at all rather than a guessed one.
export function hasFoundingSpotsToShow(status: FoundingCohortStatus | null): status is FoundingCohortStatus {
  if (!status) return false;
  return status.awardedCount >= status.cap || (status.isOpen && status.remaining > 0);
}
