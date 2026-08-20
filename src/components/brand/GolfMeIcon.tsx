interface GolfMeIconProps {
  size?: number;
  className?: string;
  /** Color of the two plain balls and the flagged ball. */
  dotColor?: string;
  /** Color of the flagstick + pennant. */
  flagColor?: string;
  /** Color of the hole's dark interior — should match whatever surface
   * this icon sits on directly (light page/card surfaces by default; pass
   * the exact background color when compositing on a colored chip or the
   * dark app-icon square) so the hole reads as a real cavity, not a
   * mismatched cutout. */
  holeColor?: string;
}

// THE canonical GolfMe brand mark — "Your Hole Is Waiting": three balls
// plus a flagged ball and an open hole (bottom-right), the round waiting
// to be finished = you. One master geometry (equal 2x2 grid, mathematically
// perfect circles/ellipses, never stretched paths) reused everywhere via
// color props instead of redrawing per context. Kept flat here (no
// gradients) since this renders as small as 14px in the UI where shading
// is imperceptible; public/icon-source.svg and public/favicon-v3.svg carry
// the fuller shaded rendering of this same geometry for the app-icon/
// favicon, which only ever sits on one fixed dark background.
export function GolfMeIcon({ size = 24, className = "", dotColor = "#166534", flagColor = "#166534", holeColor = "#f8faf8" }: GolfMeIconProps) {
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
