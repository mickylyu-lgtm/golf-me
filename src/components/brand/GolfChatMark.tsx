interface GolfChatMarkProps {
  size?: number;
  className?: string;
}

// The GolfMe brand mark: a rounded chat-bubble outline with a small tail
// (golf + communication/community) and a scatter of golf-ball dimples
// tucked into the lower-right of the bubble. One master design — color
// comes entirely from `currentColor`, so the exact same SVG serves as both
// the "light background" (wrap in a green text color) and "dark background"
// (wrap in white) version. Never hand-authored as two separate drawings.
export function GolfChatMark({ size = 24, className = "" }: GolfChatMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="GolfMe"
    >
      <rect x="6" y="7" width="36" height="26" rx="13" stroke="currentColor" strokeWidth="3" />
      <path
        d="M14 31c-1 5-4 9-8 11 5-.5 10-3 12.5-8.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="21" r="1.7" fill="currentColor" />
      <circle cx="34" cy="21" r="1.7" fill="currentColor" />
      <circle cx="30.5" cy="25.5" r="1.7" fill="currentColor" />
      <circle cx="37" cy="25.5" r="1.7" fill="currentColor" />
      <circle cx="33.5" cy="29.5" r="1.7" fill="currentColor" />
    </svg>
  );
}
