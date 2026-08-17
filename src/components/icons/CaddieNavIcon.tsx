interface CaddieNavIconProps {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

// A minimal robot-caddie head wearing a golf visor, replacing the generic
// Sparkles icon for the Caddie nav tab only (see src/lib/nav.ts). Built to
// the same prop shape lucide-react icons expose (size, strokeWidth,
// className) so it drops into NAV_ITEMS' `icon` field unchanged. Every
// color is currentColor except the two eyes and the cap's interior, which
// stay a fixed white so they read as "cutouts" against the face/cap on
// the nav bar's white background regardless of active/inactive color —
// this matches the approved reference design (dome cap outlined in
// currentColor with "AI" inside it, solid currentColor face below with
// white pill eyes).
export function CaddieNavIcon({ size = 24, strokeWidth = 1.8, className }: CaddieNavIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* cap: dome outline, "AI" lettering, and a brim seam line */}
      <path
        d="M5.3 9 C5.3 5.1 8.3 2.3 12 2.3 C15.7 2.3 18.7 5.1 18.7 9 Z"
        fill="white"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M6.6 7.6 Q12 9 17.4 7.6" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.85} strokeLinecap="round" />
      <text x="12" y="6.6" textAnchor="middle" fontSize="4.6" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
        AI
      </text>

      {/* face: solid, rounded-bottom, sitting directly under the cap */}
      <path d="M5 9 H19 V13.5 A7 7 0 0 1 5 13.5 Z" fill="currentColor" />

      {/* eyes: fixed-white pill cutouts */}
      <rect x="8.3" y="13.6" width="2.1" height="3.2" rx="1.05" fill="white" />
      <rect x="13.6" y="13.6" width="2.1" height="3.2" rx="1.05" fill="white" />
    </svg>
  );
}
