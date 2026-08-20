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
      <circle cx="14" cy="14" r="6" fill={dotColor} />
      <circle cx="14" cy="34" r="6" fill={dotColor} />
      <circle cx="34" cy="14" r="6" fill={dotColor} />
      <line x1="34" y1="14" x2="34" y2="2" stroke={flagColor} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M34 2 L39.6 4.2 L34 6.4 Z" fill={flagColor} />
      {/* the hole: a gold ring with its dark interior offset down slightly,
          so it reads as a rim you're looking into rather than a flat disc */}
      <ellipse cx="34" cy="34" rx="7.6" ry="4.8" fill="#d99a2e" />
      <ellipse cx="34" cy="34.67" rx="7" ry="4.15" fill={holeColor} />
    </svg>
  );
}
