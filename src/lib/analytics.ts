import { supabase } from "./supabase";

// Typed event interface. Every call site passes a typed event name (+
// optional properties, which are only ever logged in dev, never sent).
export type AnalyticsEvent =
  | "onboarding_started"
  | "onboarding_completed"
  | "location_selected"
  | "profile_basic_completed"
  | "first_find_clicked"
  | "first_round_viewed"
  | "first_round_joined"
  | "first_round_hosted"
  | "first_round_prompt_shown"
  | "first_round_host_started"
  | "round_shared"
  | "app_shared"
  | "notifications_permission_shown"
  | "notifications_permission_granted"
  | "notifications_permission_dismissed";

// The only events that leave the device: anonymous +1s on a daily counter
// (public.analytics_daily_counts via track_analytics_event, see migration
// 20261022130100). Must match that function's whitelist. No user id, device
// id or properties are ever sent -- the RPC takes the event name only.
const SERVER_COUNTED_EVENTS: ReadonlySet<AnalyticsEvent> = new Set<AnalyticsEvent>([
  "first_round_prompt_shown",
  "first_round_host_started",
  "first_round_hosted",
  "round_shared",
  "app_shared",
]);

// Off until a real, signed-in account says otherwise (AnalyticsGate in
// App.tsx), so demo accounts and signed-out visitors never send anything.
let serverCountingEnabled = false;

export function setAnalyticsServerCounting(enabled: boolean): void {
  serverCountingEnabled = enabled;
}

// Fire-and-forget: never throws, never awaited by callers, never blocks UI.
// A failed call (offline, migration not applied yet) is silently dropped.
export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  try {
    if (import.meta.env.DEV) {
      // Local dev talks to the live database (.env.local), so dev sessions
      // only log: they must never inflate production counts.
      console.log(`[analytics] ${event}`, properties ?? {});
      return;
    }
    if (!serverCountingEnabled || !SERVER_COUNTED_EVENTS.has(event)) return;
    void Promise.resolve(supabase.rpc("track_analytics_event", { p_event: event })).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Analytics must never break the app.
  }
}
