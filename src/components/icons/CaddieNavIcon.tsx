interface CaddieNavIconProps {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

// A minimal robot-caddie head wearing a golf visor, replacing the generic
// Sparkles icon for the Caddie nav tab only (see src/lib/nav.ts) — the
// "AI" lettering on the visor band makes the AI feature discoverable
// without the tab looking visually different in size/weight from Home/
// Play/Me. Built to the same prop shape lucide-react icons expose (size,
// strokeWidth, className) so it drops into NAV_ITEMS' `icon` field
// unchanged, and uses currentColor throughout so BottomNav/SideNav's
// existing active/inactive color handling works with zero extra code.
export function CaddieNavIcon({ size = 24, strokeWidth = 2, className }: CaddieNavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* rounded robot head */}
      <rect x="4" y="8.5" width="16" height="11.5" rx="5.5" />
      {/* visor band, worn low across the forehead */}
      <rect x="3.5" y="6" width="17" height="5" rx="2.5" />
      {/* visor bill, centered under the band */}
      <path d="M8.5 10.7 Q12 13.4 15.5 10.7" />
      {/* eyes */}
      <circle cx="9.3" cy="15.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="15.2" r="0.9" fill="currentColor" stroke="none" />
      {/* "AI" centered on the visor band */}
      <text x="12" y="9.4" textAnchor="middle" fontSize="4.1" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
        AI
      </text>
    </svg>
  );
}
