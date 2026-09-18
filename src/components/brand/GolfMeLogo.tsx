import { Link } from "react-router-dom";
import { GolfMeIcon } from "./GolfMeIcon";
import { GolfMeWordmark } from "./GolfMeWordmark";

interface GolfMeLogoProps {
  size?: number;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  className?: string;
  /** Renders as static (non-interactive) branding instead of a Home link —
   * for pre-auth screens (Welcome/Auth/Onboarding) where "/" would just
   * redirect back anyway since there's no session yet. */
  interactive?: boolean;
}

// The top-left GolfMe brand mark used in the authenticated app shell
// (desktop sidebar, mobile header) — the entire icon+wordmark area is a
// single Home link via the router's own <Link> (no full page reload, no
// session/state loss). Navigating away closes any open overlay (TopBar's
// notifications panel already closes on route change), so no extra
// coordination is needed here beyond a normal navigation.
//
// The icon chip uses GolfMeIcon's self-contained gradient variant (same
// one Splash/Auth use, and the same gradient the real home-screen app
// icon itself uses) rather than a flat CSS-colored <span> behind a flat
// icon — that flat treatment was reported live as visibly inconsistent
// with the app icon once it was right next to it (this brand mark is the
// one place in the app UI that most directly stands in for the app icon).
export function GolfMeLogo({
  size = 20,
  showWordmark = true,
  wordmarkClassName = "text-lg font-extrabold tracking-tight",
  className = "",
  interactive = true,
}: GolfMeLogoProps) {
  const content = (
    <>
      <GolfMeIcon size={Math.round(size * 1.6)} variant="gradient" className="shrink-0 rounded-lg" />
      {showWordmark && <GolfMeWordmark className={wordmarkClassName} />}
    </>
  );

  if (!interactive) {
    return <div className={`flex items-center gap-2 ${className}`}>{content}</div>;
  }

  return (
    <Link
      to="/"
      aria-label="GolfMe Home"
      className={`flex items-center gap-2 rounded-lg transition-opacity duration-150 ease-out hover:opacity-80 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${className}`}
    >
      {content}
    </Link>
  );
}
