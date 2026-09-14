import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

// The up/down field-navigation arrows + checkmark "Done" strip above the
// keyboard is WKWebView's own input accessory view -- standard browser/
// WebView form-navigation UI, not anything GolfMe renders, which is exactly
// what makes the installed app read as "a website in a WebView" rather than
// a native app. setAccessoryBarVisible is the official, documented
// @capacitor/keyboard API for this (present since v1.0.0, "only supported
// on iPhone devices" per its own docs) -- no private API, no CSS overlay
// hiding a still-present native control.
//
// Set once at app startup, not per-focus: this is a WKWebView-wide setting,
// not something that needs re-asserting on every textbox tap, and toggling
// it repeatedly is exactly the kind of per-event native-bridge chatter the
// rest of the recent keyboard work has been trying to get away from. It
// applies to every text input in the native app, not just chat -- there's
// nothing chat-specific about the accessory bar itself.
export function useDisableKeyboardAccessoryBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    void Keyboard.setAccessoryBarVisible({ isVisible: false });
  }, []);
}
