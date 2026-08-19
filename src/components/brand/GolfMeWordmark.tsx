interface GolfMeWordmarkProps {
  className?: string;
  /** Color class for "Golf" — defaults to deep forest green for light
   * backgrounds; pass a light color when placing this on a dark background. */
  golfClassName?: string;
  /** Color class for "Me" — defaults to the brand's sun/gold accent (matches
   * the CTA buttons); on a dark background pass a lighter shade (e.g.
   * text-sun-300) so it doesn't wash out. */
  meClassName?: string;
}

// "Golf" in deep forest green, "Me" in the brand's sun/gold accent —
// deliberately plain typography (no decorative treatment), meant to sit
// next to GolfMeIcon or stand alone in headings. Font weight/size are
// controlled entirely by `className` on the wrapping span so this drops
// into any existing heading.
export function GolfMeWordmark({ className = "", golfClassName = "text-fairway-800", meClassName = "text-sun-500" }: GolfMeWordmarkProps) {
  return (
    <span className={className}>
      <span className={golfClassName}>Golf</span>
      <span className={meClassName}>Me</span>
    </span>
  );
}
