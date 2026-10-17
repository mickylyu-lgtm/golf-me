import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

// Fade for the native launch screen's hand-off to the web app. Short: what's
// underneath is already the same green (EntryOverlay) or the first real screen.
const FADE_OUT_MS = 250;

let requested = false;

// Hides the native iOS launch screen, which @capacitor/splash-screen holds
// over the WKWebView (capacitor.config.ts plugins.SplashScreen) so the web
// view's cream never shows between the launch image and golfme.app's first
// paint. Safe everywhere:
// - web/PWA: not a native platform, returns before touching the plugin;
// - a TestFlight build from before the plugin was added (this JS ships via
//   Vercel ahead of the native build): isPluginAvailable is false, so no call;
// - any rejection is swallowed: if this never lands, the native side still
//   auto-hides at launchShowDuration.
export function hideNativeSplash(): void {
  if (requested) return;
  requested = true;
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("SplashScreen")) return;
    const hide = () => {
      SplashScreen.hide({ fadeOutDuration: FADE_OUT_MS }).catch(() => {});
    };
    hide();
    // The plugin ignores a hide that lands before its own show has finished
    // (its isVisible flag); a second call a beat later covers that race, and
    // is a no-op once the splash is gone.
    setTimeout(hide, 1000);
  } catch {
    // Native bridge missing or unexpected: launchShowDuration is the fallback.
  }
}
