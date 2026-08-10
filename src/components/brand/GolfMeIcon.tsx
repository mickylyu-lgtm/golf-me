interface GolfMeIconProps {
  size?: number;
  className?: string;
  /** Color of the three occupied-player circles. */
  dotColor?: string;
  /** Color of the Open Fourth target's outer ring + center dot. */
  targetColor?: string;
  /** Color of the Open Fourth target's negative-space ring — should match
   * whatever surface this icon sits on directly (light page/card surfaces
   * by default; pass the exact background color when compositing on a
   * colored chip or the dark app-icon square) so it reads as a cutout. */
  holeColor?: string;
}

// THE canonical GolfMe brand mark — "Open Fourth": three occupied player
// spots + one open target spot (bottom-right), representing the missing
// fourth player = you. One master geometry (equal 2x2 grid, mathematically
// perfect circles via <circle>, never <ellipse>/scaled paths) reused
// everywhere via color props instead of redrawing per context — see
// GolfMeLogo for the common "chip + wordmark" composition, and
// public/icon-source.svg for the app-icon/favicon raster source, which
// mirrors this exact geometry at a different scale.
export function GolfMeIcon({ size = 24, className = "", dotColor = "#19422a", targetColor = "#5aa171", holeColor = "#f8faf8" }: GolfMeIconProps) {
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
      <circle cx="34" cy="14" r="6" fill={dotColor} />
      <circle cx="14" cy="34" r="6" fill={dotColor} />
      {/* Open Fourth target: bright ring, negative-space ring, center dot. */}
      <circle cx="34" cy="34" r="6" fill={targetColor} />
      <circle cx="34" cy="34" r="4" fill={holeColor} />
      <circle cx="34" cy="34" r="1.8" fill={targetColor} />
    </svg>
  );
}
