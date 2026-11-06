import { Capacitor, registerPlugin } from "@capacitor/core";
import { Keyboard, KeyboardStyle } from "@capacitor/keyboard";
import type { AppearanceSetting } from "./appearance";

// Tells the native iOS shell which appearance the web app is in, so the
// status bar text, the keyboard, native sheets and the web view's backdrop
// match the app instead of the iPhone's own Light/Dark setting.
//
// - GolfMeAppearance (app-local plugin, ios/App/App/AppleSignInPlugin.swift):
//   overrides the window's interface style. Only in builds that contain it;
//   older App Store builds skip the call (isPluginAvailable).
// - Keyboard.setStyle (@capacitor/keyboard, in every build): the keyboard's
//   own appearance. The Keyboard plugin pins WKWebView's keyboardAppearance to
//   "default" at load, which follows the iPhone, so the keyboard needs this
//   even on builds without GolfMeAppearance.
//
// "system" is sent as "system", never resolved to light/dark: the window
// override changes what prefers-color-scheme reports, so resolving it here
// would make Match iPhone follow its own override instead of the iPhone.
// Web/PWA: nothing. Never throws; rejections are swallowed.

export type NativeAppearance = "light" | "dark" | "system";

// Pure: what the native shell should follow. A screen that forces light (the
// public landing page) wins over the setting, as on the page itself.
export function nativeAppearanceFor(setting: AppearanceSetting, forcedLight: boolean): NativeAppearance {
  return forcedLight ? "light" : setting;
}

export function keyboardStyleFor(appearance: NativeAppearance): KeyboardStyle {
  if (appearance === "dark") return KeyboardStyle.Dark;
  if (appearance === "light") return KeyboardStyle.Light;
  return KeyboardStyle.Default;
}

interface GolfMeAppearancePlugin {
  setAppearance(options: { appearance: NativeAppearance }): Promise<void>;
}

const GolfMeAppearance = registerPlugin<GolfMeAppearancePlugin>("GolfMeAppearance");

let last: NativeAppearance | null = null;

export function syncNativeAppearance(appearance: NativeAppearance): void {
  if (appearance === last) return;
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
    last = appearance;
    if (Capacitor.isPluginAvailable("GolfMeAppearance")) {
      GolfMeAppearance.setAppearance({ appearance }).catch(() => {});
    }
    if (Capacitor.isPluginAvailable("Keyboard")) {
      Keyboard.setStyle({ style: keyboardStyleFor(appearance) }).catch(() => {});
    }
  } catch {
    // Bridge missing or unexpected: the native side keeps following the iPhone.
  }
}
