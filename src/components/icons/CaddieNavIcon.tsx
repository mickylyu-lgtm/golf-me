interface CaddieNavIconProps {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

// A minimal robot-caddie head wearing a golf visor, replacing the generic
// Sparkles icon for the Caddie nav tab only (see src/lib/nav.ts). Built to
// the same prop shape lucide-react icons expose (size, strokeWidth,
// className) so it drops into NAV_ITEMS' `icon` field unchanged. Traced
// closely against an approved reference sketch: a flatter, wider dome cap
// with small rounded ear-flaps flaring out at each side (not straight
// tabs), "AI" lettering and a brim seam inside it, a rounded-square
// (robotic, not domed) face just under the cap, and two close-set pill
// eyes. The eyes and cap interior stay a fixed white (not currentColor)
// so they read as distinct cutout shapes against the nav bar's white
// background in both the active (green) and inactive (gray) states.
export function CaddieNavIcon({ size = 24, strokeWidth = 2.1, className }: CaddieNavIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* cap: flatter, wider dome */}
      <path
        d="M4 9.6 C4 5.6 7.6 2.6 12 2.6 C16.4 2.6 20 5.6 20 9.6 Z"
        fill="white"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* rounded ear-flaps flaring out at each side of the cap's base */}
      <circle cx="4" cy="10" r="1.6" fill="white" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="20" cy="10" r="1.6" fill="white" stroke="currentColor" strokeWidth={strokeWidth} />
      {/* brim seam */}
      <path d="M5.8 8.2 Q12 10.3 18.2 8.2" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.8} strokeLinecap="round" />
      {/* "AI" lettering — dropped clear of the dome's peak (y≈2.6 at
          center) so the glyphs sit inside the cap instead of poking
          above its outline */}
      <text x="12" y="7.7" textAnchor="middle" fontSize="6.6" fontWeight="900" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif" letterSpacing="-0.2">
        AI
      </text>

      {/* face: rounded square, not a dome — reads as robotic */}
      <rect x="4.8" y="9.6" width="14.4" height="9.2" rx="3.2" fill="currentColor" />

      {/* eyes: close-set pills, fixed-white cutouts */}
      <rect x="9.3" y="13.6" width="2" height="3.3" rx="1" fill="white" />
      <rect x="12.7" y="13.6" width="2" height="3.3" rx="1" fill="white" />
    </svg>
  );
}
