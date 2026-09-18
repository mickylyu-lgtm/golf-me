import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";

const SPLASH_DURATION_MS = 2750;

// Native-app-only stop between AuthedLayout's logged-out redirect and
// /login (see App.tsx / isStandalone()) -- an installed PWA already skips
// the marketing pitch and goes straight to Login, but going instant felt
// like a blank flash on the native TestFlight/App Store build, so this
// holds the brand mark on screen for a beat first, matching what a native
// app's own launch screen would normally feel like.
export function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => navigate("/login", { replace: true }), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-fairway-800"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Rendered at the FULL chip size (not a smaller icon inset inside a
          separately-colored chip) -- this is the exact screen compared
          side-by-side against the real home-screen app icon (reported
          live); a smaller inset icon over its own separate chip
          background left a visible seam/washed-out look even with
          matching colors (see GolfMeIcon's own comment). One
          self-contained SVG, sized to fill the chip exactly, matches it
          with no seam. */}
      <GolfMeIcon size={80} variant="gradient" className="rounded-3xl shadow-lg shadow-black/25" />
    </div>
  );
}
