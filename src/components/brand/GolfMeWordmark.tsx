interface GolfMeWordmarkProps {
  className?: string;
  /** Color class for "Golf" — defaults to deep forest green for light
   * backgrounds; pass a light color when placing this on a dark background. */
  golfClassName?: string;
  /** Color class for "Me" — defaults to bright GolfMe green; on a dark
   * background (e.g. the Welcome hero) pass a brighter shade so it doesn't
   * wash out against the dark fairway gradient. */
  meClassName?: string;
}

// "Golf" in deep forest green, "Me" in bright GolfMe green — deliberately
// plain typography (no decorative treatment), meant to sit next to
// GolfMeIcon or stand alone in headings. Font weight/size are controlled
// entirely by `className` on the wrapping span so this drops into any
// existing heading.
export function GolfMeWordmark({ className = "", golfClassName = "text-fairway-800", meClassName = "text-fairway-500" }: GolfMeWordmarkProps) {
  return (
    <span className={className}>
      <span className={golfClassName}>Golf</span>
      <span className={meClassName}>Me</span>
    </span>
  );
}
