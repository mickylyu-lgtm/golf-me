// "Notify me" on an empty round search. GolfMe has no saved-search alerts;
// what it does have is the server-side new-round fan-out (migration
// 20261030120000, notify-fanout): when a real round opens, golfers whose
// saved home area (profiles.playing_area_lat/lng) is within their travel
// radius of the course get a bell notification, plus a push when
// profiles.push_enabled is on and this iPhone has a token. Capped at 3 a day.
// The switch is profiles.notify_new_rounds ("New rounds near me" in
// Settings). So the button turns THAT on and says plainly what it covers,
// instead of promising an alert for this exact search.
//
// Pure (type-only imports) so tests/roundAlerts.test.ts runs it under
// node --test; RoundAlertsCard.tsx wires it to AuthContext and lib/push.

export type PushPermission = "granted" | "denied" | "prompt" | "unavailable";

// Mirrors the fan-out's radius rule: least(100, case when travel_radius_miles
// > 0 then travel_radius_miles else 25 end).
export const DEFAULT_ALERT_RADIUS_MILES = 25;
export const MAX_ALERT_RADIUS_MILES = 100;

export function alertRadiusMiles(travelRadiusMiles: number | null | undefined): number {
  const r = typeof travelRadiusMiles === "number" && Number.isFinite(travelRadiusMiles) && travelRadiusMiles > 0 ? travelRadiusMiles : DEFAULT_ALERT_RADIUS_MILES;
  return Math.min(MAX_ALERT_RADIUS_MILES, Math.round(r));
}

export type RoundAlertState =
  | "noHomeArea" // fan-out skips golfers without saved coordinates
  | "off"
  | "saving"
  | "saveFailed"
  | "onDemo" // demo never fans out; local switch only
  | "onWeb" // bell only; push needs the iPhone app
  | "onChecking" // native, permission not read yet
  | "onPush" // bell + push on this iPhone
  | "onPushOff" // push_enabled off in Settings: bell only
  | "onPushDenied" // iOS permission denied: bell only
  | "onPushPrompt" // iOS permission not asked yet: bell only until allowed
  | "onInApp"; // permission unreadable (older build): bell only

export interface RoundAlertInputs {
  isDemo: boolean;
  hasHomeArea: boolean;
  notifyOn: boolean;
  pushEnabled: boolean;
  native: boolean;
  /** null while it's still being read on a native device */
  permission: PushPermission | null;
  saving: boolean;
  saveFailed: boolean;
}

export function deriveRoundAlertState(i: RoundAlertInputs): RoundAlertState {
  if (!i.hasHomeArea) return "noHomeArea";
  if (i.saving) return "saving";
  if (!i.notifyOn) return i.saveFailed ? "saveFailed" : "off";
  if (i.isDemo) return "onDemo";
  if (!i.native) return "onWeb";
  if (!i.pushEnabled) return "onPushOff";
  if (i.permission === null) return "onChecking";
  if (i.permission === "granted") return "onPush";
  if (i.permission === "denied") return "onPushDenied";
  if (i.permission === "prompt") return "onPushPrompt";
  return "onInApp";
}

export interface EnableRoundAlertsDeps {
  isDemo: boolean;
  native: boolean;
  pushEnabled: boolean;
  /** Real: saveProfile({ notify_new_rounds: true }). Demo: local state. Must reject on failure. */
  save: () => Promise<void>;
  checkPermission: () => Promise<PushPermission>;
  /** registerPushNotifications: shows Apple's dialog only while permission is "prompt". */
  requestPush: () => Promise<void>;
}

export type EnableRoundAlertsResult = { ok: true; permission: PushPermission | null } | { ok: false; error: unknown };

/**
 * Turns new-round alerts on. Success is reported only after the save
 * resolves. On a real native account with push on, asks for push only if iOS
 * hasn't been asked yet; never on web, demo, or when push is off in Settings.
 */
export async function enableRoundAlerts(deps: EnableRoundAlertsDeps): Promise<EnableRoundAlertsResult> {
  try {
    await deps.save();
  } catch (error) {
    return { ok: false, error };
  }
  return { ok: true, permission: await askForPushIfUndecided(deps) };
}

/** Also used by the "Allow push" action when alerts were already on. */
export async function askForPushIfUndecided(deps: Pick<EnableRoundAlertsDeps, "isDemo" | "native" | "pushEnabled" | "checkPermission" | "requestPush">): Promise<PushPermission | null> {
  if (deps.isDemo || !deps.native || !deps.pushEnabled) return null;
  let permission = await deps.checkPermission();
  if (permission === "prompt") {
    await deps.requestPush();
    permission = await deps.checkPermission();
  }
  return permission;
}
