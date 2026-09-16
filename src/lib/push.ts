import { Capacitor } from "@capacitor/core";
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

    await PushNotifications.removeAllListeners();
    PushNotifications.addListener("registration", (token) => {
      setStoredToken(token.value);
      supabase
        .from("device_push_tokens")
        .upsert({ token: token.value, user_id: userId, platform: "ios", updated_at: new Date().toISOString() }, { onConflict: "token" })
        .then(({ error }) => {
          if (error) console.error("Golf Me: failed to save push token.", error);
        });
    });
    PushNotifications.addListener("registrationError", (err) => {
      console.error("Golf Me: push registration error.", err);
    });

    await PushNotifications.register();
  } catch (err) {
    console.error("Golf Me: push setup failed.", err);
  }
}

// Reads the OS permission state without ever prompting — used by
// PushPrePermissionPrompt.tsx to decide whether it needs to show its own UI
// at all (already-granted or already-denied devices skip straight past it).
export async function checkPushPermission(): Promise<"granted" | "denied" | "prompt"> {
  if (!Capacitor.isNativePlatform()) return "denied";
  try {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") return "granted";
    if (receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
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
    if (error) console.error("Golf Me: failed to unregister push token.", error);
  } catch (err) {
    console.error("Golf Me: push unregister failed.", err);
  } finally {
    setStoredToken(null);
  }
}
