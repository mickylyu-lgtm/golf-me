import { Link } from "react-router-dom";
import { GolfMeIcon } from "./GolfMeIcon";
import { GolfMeWordmark } from "./GolfMeWordmark";

interface GolfMeLogoProps {
  size?: number;
  chipClassName?: string;
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
export function GolfMeLogo({
  size = 20,
  chipClassName = "bg-fairway-600",
  showWordmark = true,
  wordmarkClassName = "text-lg font-extrabold tracking-tight",
  className = "",
  interactive = true,
}: GolfMeLogoProps) {
  const content = (
    <>
      <span
        className={`flex shrink-0 items-center justify-center rounded-lg ${chipClassName}`}
        style={{ width: Math.round(size * 1.6), height: Math.round(size * 1.6) }}
      >
        <GolfMeIcon size={size} dotColor="#f8faf8" targetColor="#5aa171" holeColor="#143621" />
      </span>
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
