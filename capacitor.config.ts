import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Not "com.golfme.app" -- Xcode's App Store Connect registration
  // consistently rejects that identifier as "not available" even though it
  // doesn't appear in this account's Identifiers list, App Store Connect
  // apps, or any second Apple ID on this Mac -- some Apple-side reservation
  // we can't see or clear. Changed 2026-08-31 to unblock upload; harmless
  // otherwise since nothing else keys off this string (auth redirects use
  // window.location.origin, not a custom URL scheme).
  appId: "com.golfme.ios",
  appName: "GolfMe",
  webDir: "dist",
  // Loads the live site instead of the bundled dist/ snapshot, so every
  // Vercel deploy updates the TestFlight app instantly too -- no new Xcode
  // archive/upload needed for ordinary feature or bug-fix work, only for
  // genuinely native changes (permissions, icon, native plugins). GolfMe is
  // Supabase-backed and needs network for everything anyway, so there's no
  // meaningful offline mode being given up here.
  server: {
    url: "https://golfme.app",
  },
  // WKWebView's own background defaults to black. iOS pans the visual
  // viewport to keep a focused textbox clear of the keyboard independent of
  // any in-page CSS/JS -- during that pan there's a brief moment where the
  // WebView shows its native background instead of page content, which
  // read as a black flash/drop on every textbox tap (reported live). This
  // paints that native layer the app's own cream instead, so the same
  // momentary reveal is invisible against the page rather than a black
  // flash. This is a native (Capacitor config) change -- needs `npx cap
  // sync ios` + a fresh Xcode archive, not just a Vercel deploy.
  backgroundColor: "#faf9f6",
};

export default config;
