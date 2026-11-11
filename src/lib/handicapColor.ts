import type { TranslationKey } from "../i18n/locales/en";

// Presentation only. Handicap flair never changes GolfMe Reputation,
// verification, matching, reviews, or the already-stored handicap value.
// Negative stored values are plus handicaps (for example, -2 displays +2).
// Keep every finite value and its existing precision; do not clamp or round.
export type HandicapTone = "gold" | "violet" | "teal" | "forest" | "sage" | "neutral";

export function hasHandicap(handicap: number | null): handicap is number {
  return typeof handicap === "number" && Number.isFinite(handicap);
}

export function handicapTone(handicap: number | null): HandicapTone {
  if (!hasHandicap(handicap)) return "neutral";
  if (handicap <= 0) return "gold";
  if (handicap < 5) return "violet";
  if (handicap < 10) return "teal";
  if (handicap < 20) return "forest";
  if (handicap < 30) return "sage";
  return "neutral";
}

// Shared by profiles, golfer cards, and Compare. Decoration decreases as
// the handicap rises; readable contrast does not. CSS owns both appearances.
export function handicapColorClass(handicap: number | null): string {
  return `gm-handicap gm-handicap--${handicapTone(handicap)}`;
}

export function formatHandicapNumber(handicap: number | null): string {
  if (!hasHandicap(handicap)) return "--";
  if (handicap < 0) return `+${Math.abs(handicap)}`;
  return String(handicap);
}

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Shared localized label, also re-exported from format.ts for existing callers.
// Formatting a plus handicap must never change its stored value or tier.
export function handicapLabel(handicap: number | null, t: TFn): string {
  if (!hasHandicap(handicap)) return t("golfCallDetail.noHandicapYet");
  return t("golfCallDetail.handicapValue", { handicap: formatHandicapNumber(handicap) });
}
