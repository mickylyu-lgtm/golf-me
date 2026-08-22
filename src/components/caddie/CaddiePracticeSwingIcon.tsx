interface CaddiePracticeSwingIconProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

// Caddie's mascot taking a practice swing — used on the analysis
// processing screen, replacing a plain spinner for something that
// actually reads as "Caddie, thinking about golf" during the 30-90s+
// Roboflow+Gemini pipeline. The club is the only animated part (a single
// <g> rotating around the hand pivot); everything else stays still, same
// "hold the pose, animate one deliberate thing" approach as the existing
// GolfMeLoader cart scene's wheel-spin.
export function CaddiePracticeSwingIcon({ size = 56, className = "", animated = true }: CaddiePracticeSwingIconProps) {
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} className={className} role="presentation" aria-hidden="true">
      {/* ground + ball */}
      <line x1="6" y1="49" x2="50" y2="49" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
      <circle cx="15" cy="47.5" r="2" fill="currentColor" opacity="0.9" />

      {/* club — rotates around the hand pivot (32, 23); baseline angle
          rests the clubhead near the ball, matching a real address position */}
      <g style={{ transformOrigin: "32px 23px" }} className={animated ? "animate-caddie-swing-club" : ""}>
        <line x1="32" y1="23" x2="16.5" y2="46" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="14.5" y1="45.5" x2="19" y2="47.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </g>

      {/* golfer — cap, face, simple standing body, held still */}
      <path
        d="M23 13 C23 8.6 27 5.2 32 5.2 C37 5.2 41 8.6 41 13 Z"
        fill="white"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M24.3 11.7 Q32 13.6 39.7 11.7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* "AI" lettering, matching CaddieNavIcon's cap treatment so the
          same mascot reads consistently across the nav tab and this
          processing-screen icon */}
      <text x="32" y="10.2" textAnchor="middle" fontSize="6.2" fontWeight="900" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif" letterSpacing="-0.3">
        AI
      </text>
      <rect x="24.5" y="13" width="15" height="10.5" rx="3.6" fill="currentColor" />
      <rect x="27.8" y="16.6" width="2.2" height="3.6" rx="1.1" fill="white" />
      <rect x="34" y="16.6" width="2.2" height="3.6" rx="1.1" fill="white" />
      <path
        d="M28 23.5 L26 34 Q26 38 29 38 L35 38 Q38 38 38 34 L36 23.5 Z"
        fill="currentColor"
        opacity="0.92"
      />
      <line x1="29.5" y1="38" x2="28" y2="46" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="34.5" y1="38" x2="37" y2="46" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
