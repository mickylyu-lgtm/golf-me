// Typed event interface for future analytics — no provider wired up yet,
// so track() just logs in dev. Swapping in a real provider (Segment,
// PostHog, etc.) later only means changing the body of track(), never any
// call site, since every call site already passes a typed event name +
// properties.
export type AnalyticsEvent =
  | "onboarding_started"
  | "onboarding_completed"
  | "location_selected"
  | "profile_basic_completed"
  | "first_find_clicked"
  | "first_round_viewed"
  | "first_round_joined"
  | "first_round_hosted"
  | "notifications_permission_shown"
  | "notifications_permission_granted"
  | "notifications_permission_dismissed";

export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.log(`[analytics] ${event}`, properties ?? {});
  }
}
