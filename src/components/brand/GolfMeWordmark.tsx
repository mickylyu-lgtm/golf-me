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
// sun-500 Tailwind tokens used originally) come straight from
// public/icon-source.svg — the real app icon's own source — so the
// wordmark's colors read as the SAME green/gold as the icon right next
// to it, not just a similar pairing (reported live, twice: first that
// the tokens were off, then that the gold specifically still didn't read
// as "the gold ring" and wanted something more vintage). "Me" now uses
// the ring gradient's own MIDDLE stop (#f0b93f) rather than its darkest
// end (#dc9d24) -- the darkest stop is designed to sit in the ring's own
// shadow side against the icon's dark background, and read as a muddy
// brown-olive rather than gold once used as flat text on a light page;
// the middle stop is the ring's actual dominant, most gold-reading tone.
// Font weight/size are controlled entirely by `className` on the
// wrapping span so this drops into any existing heading.
export function GolfMeWordmark({ className = "", golfClassName = "text-brand-forest", meClassName = "text-brand-gold" }: GolfMeWordmarkProps) {
  return (
    <span className={className}>
      <span className={golfClassName}>Golf</span>
      <span className={meClassName}>Me</span>
    </span>
  );
}
