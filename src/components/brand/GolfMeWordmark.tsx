interface GolfMeWordmarkProps {
  className?: string;
  /** Color class for "Golf" — defaults to dark/neutral text for light
   * backgrounds; pass a light color when placing this on a dark background. */
  golfClassName?: string;
  /** Color class for "Me" — defaults to GolfMe green; on a dark background
   * (e.g. the Welcome hero) pass a brighter shade so it doesn't wash out
   * against the dark fairway gradient. */
  meClassName?: string;
}

// "Golf" in dark/neutral text, "Me" in GolfMe green — deliberately plain
// typography (no decorative treatment), meant to sit next to GolfChatMark
// or stand alone in headings. Font weight/size are controlled entirely by
// `className` on the wrapping span so this drops into any existing heading.
export function GolfMeWordmark({ className = "", golfClassName = "text-slate-900", meClassName = "text-fairway-500" }: GolfMeWordmarkProps) {
  return (
    <span className={className}>
      <span className={golfClassName}>Golf</span>
      <span className={meClassName}>Me</span>
    </span>
  );
}
