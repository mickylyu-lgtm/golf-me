import type { ReactNode } from "react";

interface HighlightGolfMeProps {
  text: string;
  /** Color for "Golf" — defaults to deep forest green for light backgrounds; pass a light color on a dark background. */
  golfClassName?: string;
  /** Color for "Me" — defaults to bright GolfMe green; on a dark background pass a brighter shade so it doesn't wash out. */
  meClassName?: string;
}

// Recolors every literal "GolfMe" inside an already-translated string to
// match GolfMeWordmark's own "Golf"/"Me" split, so the brand name reads
// identically wherever it shows up as plain text, not just next to the
// actual logo mark. Safe across locales because "GolfMe" is kept as an
// untranslated brand token in all 6 locale files (verified directly, not
// assumed) — this never touches surrounding translated text, only splits
// on that one literal substring.
export function HighlightGolfMe({ text, golfClassName = "text-fairway-800", meClassName = "text-fairway-500" }: HighlightGolfMeProps): ReactNode {
  const parts = text.split("GolfMe");
  if (parts.length === 1) return text;
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) nodes.push(<span key={`t-${i}`}>{part}</span>);
    if (i < parts.length - 1) {
      nodes.push(
        <span key={`g-${i}`}>
          <span className={golfClassName}>Golf</span>
          <span className={meClassName}>Me</span>
        </span>,
      );
    }
  });
  return <>{nodes}</>;
}
