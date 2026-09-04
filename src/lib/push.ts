import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase";

// Registers this device for real APNs push and upserts the resulting token
// against the signed-in user. No-ops entirely on web (Capacitor.isNativePlatform()
// false) — there is no push story for the browser/PWA, same scope line every
// other native-only feature here draws (see AuthContext's appUrlOpen handling).
// Never throws: a denied permission or a registration error just means this
// device gets no push, never a broken sign-in.
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
