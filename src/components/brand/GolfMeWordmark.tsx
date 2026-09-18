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

// "Golf" in deep forest green, "Me" in gold — deliberately plain
// typography (no decorative treatment), meant to sit next to GolfMeIcon
// or stand alone in headings. The exact hex values (not the fairway-800/
// sun-500 Tailwind tokens used previously) are the same green/gold
// public/icon-source.svg — the real app icon's own source — uses for its
// background and gold rim, so the wordmark's colors read as the SAME
// green/gold as the icon right next to it, not just a similar pairing
// (reported live: the token-based colors were noticeably off from the
// icon once the icon itself got the accurate gradient treatment). Font
// weight/size are controlled entirely by `className` on the wrapping
// span so this drops into any existing heading.
export function GolfMeWordmark({ className = "", golfClassName = "text-[#1b4a2d]", meClassName = "text-[#dc9d24]" }: GolfMeWordmarkProps) {
  return (
    <span className={className}>
      <span className={golfClassName}>Golf</span>
      <span className={meClassName}>Me</span>
    </span>
  );
}
