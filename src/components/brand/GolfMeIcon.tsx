import { useId } from "react";

interface GolfMeIconProps {
  size?: number;
  className?: string;
  /** Color of the two plain balls and the flagged ball. Ignored when
   * variant="gradient" (that mode always uses the same shaded gradients
   * as the real app icon, regardless of what's passed here). */
  dotColor?: string;
  /** Color of the flagstick + pennant. Ignored when variant="gradient". */
  flagColor?: string;
  /** Color of the hole's dark interior — should match whatever surface
   * this icon sits on directly (light page/card surfaces by default; pass
   * the exact background color when compositing on a colored chip or the
   * dark app-icon square) so the hole reads as a real cavity, not a
   * mismatched cutout. Ignored when variant="gradient". */
  holeColor?: string;
  /** "flat" (default): solid color props below, cheap at the many small
   * (14-24px) sizes this renders at across nav/tab chrome, where shading
   * is imperceptible anyway. "gradient": the same shaded rendering the
   * real home-screen app icon uses (see public/icon-source.svg) — use
   * this ONLY at the few large (~34px+) brand-moment sizes (Splash,
   * Welcome, Auth) where a golfer can actually compare it side-by-side
   * with the app icon and a flat fill reads as noticeably less
   * "authentic" (reported live). Needs its own gradient chip background
   * behind it — see GRADIENT_CHIP_CLASS below. */
  variant?: "flat" | "gradient";
}

// The dark-green gradient chip background the "gradient" icon variant is
// designed to sit on — matches public/icon-source.svg's own `bg` gradient
// exactly. Exported so Splash/Welcome/Auth can share the identical chip
// color instead of three hand-copied gradient strings drifting apart.
export const GOLFME_GRADIENT_CHIP_CLASS = "bg-gradient-to-br from-[#1b4a2d] to-[#0e2717]";

// THE canonical GolfMe brand mark — "Your Hole Is Waiting": three balls
// plus a flagged ball and an open hole (bottom-right), the round waiting
// to be finished = you. One master geometry (equal 2x2 grid, mathematically
// perfect circles/ellipses, never stretched paths) reused everywhere via
// color props instead of redrawing per context. Flat by default (no
// gradients) since this renders as small as 14px in most of the UI where
// shading is imperceptible; variant="gradient" opts a specific instance
// into the same fuller shaded rendering public/icon-source.svg and
// public/favicon-v3.svg already carry for the app-icon/favicon.
export function GolfMeIcon({
  size = 24,
  className = "",
  dotColor = "#166534",
  flagColor = "#166534",
  holeColor = "#f8faf8",
  variant = "flat",
}: GolfMeIconProps) {
  // Unique per instance so multiple gradient icons on one page (unlikely
  // today, but cheap to guard) never collide on the same gradient id and
  // silently paint from whichever instance's <defs> happened to render last.
  const gid = useId();

  if (variant === "gradient") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="GolfMe"
        className={className}
        style={{ aspectRatio: "1 / 1" }}
      >
        <defs>
          <radialGradient id={`${gid}-ball`} cx="0.32" cy="0.28" r="0.85">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#e4e9e1" />
          </radialGradient>
          <linearGradient id={`${gid}-flagLit`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4fc169" />
            <stop offset="1" stopColor="#2c9247" />
          </linearGradient>
          <linearGradient id={`${gid}-flagShade`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#237a3a" />
            <stop offset="1" stopColor="#14602a" />
          </linearGradient>
          <linearGradient id={`${gid}-rimFace`} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#ffdd85" />
            <stop offset="0.5" stopColor="#f0b93f" />
            <stop offset="1" stopColor="#dc9d24" />
          </linearGradient>
          <radialGradient id={`${gid}-cavity`} cx="0.5" cy="0.15" r="1.05">
            <stop offset="0" stopColor="#16321f" />
            <stop offset="0.4" stopColor="#0a1f13" />
            <stop offset="1" stopColor="#020805" />
          </radialGradient>
        </defs>
        <circle cx="13.9" cy="13.9" r="6.15" fill={`url(#${gid}-ball)`} />
        <circle cx="13.9" cy="34.1" r="6.15" fill={`url(#${gid}-ball)`} />
        <circle cx="34.1" cy="13.9" r="6.15" fill={`url(#${gid}-ball)`} />
        <line x1="34.1" y1="7.8" x2="34.1" y2="2.7" stroke="#2c9247" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M34.1 2.92 L39.7 4.83 L34.1 5.72 Z" fill={`url(#${gid}-flagLit)`} />
        <path d="M34.1 5.72 L39.7 4.83 L34.1 7.63 Z" fill={`url(#${gid}-flagShade)`} />
        <ellipse cx="34.1" cy="34.1" rx="7.8" ry="4.9" fill={`url(#${gid}-rimFace)`} />
        <ellipse cx="34.1" cy="34.75" rx="7.2" ry="4.25" fill={`url(#${gid}-cavity)`} />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="GolfMe"
      className={className}
      style={{ aspectRatio: "1 / 1" }}
    >
      <circle cx="12.8" cy="12.8" r="6.7" fill={dotColor} />
      <circle cx="12.8" cy="35.2" r="6.7" fill={dotColor} />
      <circle cx="35.2" cy="12.8" r="6.7" fill={dotColor} />
      <line x1="35.2" y1="12.8" x2="35.2" y2="1.2" stroke={flagColor} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M35.2 1.4 L42.4 1.95 L35.2 2.95 Z" fill={flagColor} />
      {/* the hole: a gold ring with its dark interior offset down slightly,
          so it reads as a rim you're looking into rather than a flat disc */}
      <ellipse cx="35.2" cy="35.2" rx="8.5" ry="5.4" fill="#d99a2e" />
      <ellipse cx="35.2" cy="35.95" rx="7.8" ry="4.65" fill={holeColor} />
    </svg>
  );
}
