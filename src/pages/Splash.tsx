import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GolfMeIcon, GOLFME_GRADIENT_CHIP_CLASS } from "../components/brand/GolfMeIcon";

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
      {/* Gradient variant + matching chip -- this is the exact screen
          compared side-by-side against the real home-screen app icon
          (reported live); the previous flat fill read as noticeably less
          "authentic" next to it at this size. */}
      <span className={`flex h-20 w-20 items-center justify-center rounded-3xl ${GOLFME_GRADIENT_CHIP_CLASS}`}>
        <GolfMeIcon size={44} variant="gradient" />
      </span>
    </div>
  );
}
