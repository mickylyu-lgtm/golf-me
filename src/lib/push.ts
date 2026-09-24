import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase";

// Caches the current device's own APNs token locally so logout can find and
// remove exactly that row later (see unregisterPushNotifications below) —
// the plugin only ever hands back a token via the async "registration"
// event, there's no synchronous getter to re-read it from later. Survives
// app restarts (module state wouldn't); cleared once unregistered.
const LAST_TOKEN_KEY = "golfme:lastPushToken";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(LAST_TOKEN_KEY, token);
    else window.localStorage.removeItem(LAST_TOKEN_KEY);
  } catch {
    // Best-effort only — a failed localStorage write here just means the
    // next unregister call has nothing to clean up, never a crash.
  }
}

// Handles for the two listeners registerPushNotifications owns, so a repeat
// call can swap out just its own listeners. It must NOT call
// PushNotifications.removeAllListeners(): that also drops App.tsx's
// PushNotificationRouting "pushNotificationActionPerformed" listener, and
// tapping a push while the app is in the background then does nothing until
// the next navigation re-adds it (audit P3-1).
let registrationListeners: PluginListenerHandle[] = [];

async function removeRegistrationListeners(): Promise<void> {
  const handles = registrationListeners;
  registrationListeners = [];
  await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
}

// Saves this device's token for the signed-in user. Prefers the
// register_device_push_token RPC, which can move a token that still belongs
// to a previous account on this phone over to the current account. The
// plain upsert is blocked by RLS in that case (42501): the update policy's
// USING clause is checked against the existing row, which is the other
// user's. Falls back to the old upsert only while that migration isn't
// applied yet (PGRST202 = function not in the schema cache), so deploy
// order between the migration and the web app doesn't matter.
async function saveToken(token: string, userId: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc("register_device_push_token", { p_token: token });
  if (!rpcError) return;
  if (rpcError.code !== "PGRST202") {
    console.error("GolfMe: failed to save push token.", rpcError);
    return;
  }
  const { error } = await supabase
    .from("device_push_tokens")
    .upsert({ token, user_id: userId, platform: "ios", updated_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) console.error("GolfMe: failed to save push token.", error);
}

// Registers this device for real APNs push and upserts the resulting token
// against the signed-in user. No-ops entirely on web (Capacitor.isNativePlatform()
// false) — there is no push story for the browser/PWA, same scope line every
// other native-only feature here draws (see AuthContext's appUrlOpen handling).
// Never throws: a denied permission or a registration error just means this
// device gets no push, never a broken sign-in.
//
// Only actually prompts the user (via requestPermissions()) when the OS
// permission state is still "prompt" — callers control WHEN that's
// appropriate to trigger (see PushPrePermissionPrompt.tsx, the only caller
// that can reach a user who's never decided yet); a caller re-registering an
// already-granted or already-denied device never sees any UI here, this
// just silently confirms/refreshes the token or silently no-ops.
export async function registerPushNotifications(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted") return;

    await removeRegistrationListeners();
    registrationListeners = await Promise.all([
      PushNotifications.addListener("registration", (token) => {
        setStoredToken(token.value);
        void saveToken(token.value, userId);
      }),
      // Without the aps-environment entitlement (Xcode's Push Notifications
      // capability), iOS still shows and grants the permission prompt, then
      // fails here with "no valid 'aps-environment' entitlement string found".
      PushNotifications.addListener("registrationError", (err) => {
        console.error("GolfMe: push registration error.", err);
      }),
    ]);

    await PushNotifications.register();
  } catch (err) {
    console.error("GolfMe: push setup failed.", err);
  }
}

// Reads the OS permission state without ever prompting — used by
// PushPrePermissionPrompt.tsx to decide whether it needs to show its own UI
// at all (already-granted or already-denied devices skip straight past it).
//
// "unavailable" means the call itself failed, e.g. an older native build
// without the push plugin. That isn't the user's decision, so
// PushPrePermissionPrompt doesn't use up its one-time screen on it.
export async function checkPushPermission(): Promise<"granted" | "denied" | "prompt" | "unavailable"> {
  if (!Capacitor.isNativePlatform()) return "denied";
  try {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") return "granted";
    if (receive === "denied") return "denied";
    return "prompt";
  } catch (err) {
    console.error("GolfMe: push permission check failed.", err);
    return "unavailable";
  }
}

// Removes just THIS device's token, so a logged-out device stops being a
// valid push target immediately rather than waiting on Apple to eventually
// 410 a stale token. Called from AuthContext.signOut() while still
// authenticated — the new device_push_tokens_delete_own RLS policy only
// allows deleting a row where user_id = auth.uid(), so this must run before
// supabase.auth.signOut() actually clears the session. Never throws: a
// failed cleanup here should never block sign-out itself.
export async function unregisterPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const token = getStoredToken();
  if (!token) return;
  try {
    const { error } = await supabase.from("device_push_tokens").delete().eq("token", token);
    if (error) console.error("GolfMe: failed to unregister push token.", error);
  } catch (err) {
    console.error("GolfMe: push unregister failed.", err);
  } finally {
    setStoredToken(null);
  }
}
