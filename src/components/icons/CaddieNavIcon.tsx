interface CaddieNavIconProps {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

// A minimal robot-caddie head wearing a golf visor, replacing the generic
// Sparkles icon for the Caddie nav tab only (see src/lib/nav.ts). Built to
// the same prop shape lucide-react icons expose (size, strokeWidth,
// className) so it drops into NAV_ITEMS' `icon` field unchanged. Rounder
// and chunkier than a strict geometric trace — thicker strokes, a fuller
// dome, big round eyes — with "AI" sized up so it reads at a glance rather
// than needing a close look. The eyes and cap interior stay a fixed white
// (not currentColor) so they read as distinct cutout shapes against the
// nav bar's white background in both the active (green) and inactive
// (gray) states.
export function CaddieNavIcon({ size = 24, strokeWidth = 2.1, className }: CaddieNavIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* cap: wide rounded dome — deliberately wider than the face below it,
          so the brim reads as a real overhang and "AI" gets more room */}
      <path
        d="M2.8 9.4 C2.8 4.5 6.8 1 12 1 C17.2 1 21.2 4.5 21.2 9.4 Z"
        fill="white"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* side tabs where the wide brim overhangs the narrower face */}
      <line x1="2.8" y1="9.4" x2="2.8" y2="11.2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <line x1="21.2" y1="9.4" x2="21.2" y2="11.2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* brim seam */}
      <path d="M4.5 7.9 Q12 10.4 19.5 7.9" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.8} strokeLinecap="round" />
      {/* "AI" lettering — sized to read at a glance, not a close look */}
      <text x="12" y="6.7" textAnchor="middle" fontSize="7.4" fontWeight="900" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif" letterSpacing="-0.2">
        AI
      </text>

      {/* face: solid, rounder and chunkier than a strict dome */}
      <path d="M4.8 9.6 H19.2 V13.8 A7.2 7.2 0 0 1 4.8 13.8 Z" fill="currentColor" />

      {/* eyes: big, round, cartoon-friendly, fixed-white cutouts */}
      <circle cx="9.7" cy="14" r="1.65" fill="white" />
      <circle cx="14.3" cy="14" r="1.65" fill="white" />
    </svg>
  );
}
