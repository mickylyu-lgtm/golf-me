// The clubs Caddie's picker offers (AnalyzeSwing -> ClubPicker), grouped
// by the category cards. The values are what caddie_analyses.swing_type
// stores, in English, so they must never change once shipped: every value
// from the old dropdown is kept exactly ("52° Wedge", "Pitching Wedge", ...)
// and the new ones follow the same style. clubLabel() translates them for
// display. analyze-swing stores the string as given and only passes it to
// Gemini as "The golfer says this is a: <value>." (no server allowlist).
// No "Putter": Caddie's pose checks and scoring (backswing top, hip sway,
// weight transfer, finish) only describe a full swing, so a putting stroke
// would get confident-looking but meaningless feedback.
// No React imports, so tests/clubLabel.test.ts runs under plain node --test.
import { parseClub } from "./clubLabel.ts";

export type ClubCategory = "driver" | "wood" | "hybrid" | "iron" | "wedge";

export const CLUB_CATEGORIES: readonly ClubCategory[] = ["driver", "wood", "hybrid", "iron", "wedge"];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const CLUBS_BY_CATEGORY: Record<ClubCategory, readonly string[]> = {
  driver: ["Driver", "Mini Driver"],
  wood: [2, 3, 4, 5, 7, 9].map((n) => `${n} Wood`),
  hybrid: range(2, 7).map((n) => `${n} Hybrid`),
  iron: range(1, 9).map((n) => `${n} Iron`),
  wedge: ["Pitching Wedge", "Gap Wedge", "Sand Wedge", "Lob Wedge", ...range(23, 32).map((half) => `${half * 2}° Wedge`)],
};

export const ALL_CLUB_VALUES: readonly string[] = CLUB_CATEGORIES.flatMap((c) => CLUBS_BY_CATEGORY[c]);

/** The category card a stored value belongs to (also for older typed values), or null. */
export function clubCategoryOf(value: string | null | undefined): ClubCategory | null {
  const club = parseClub(value);
  if (!club) return null;
  switch (club.kind) {
    case "driver":
    case "miniDriver":
      return "driver";
    case "wood":
    case "hybrid":
    case "iron":
      return club.kind;
    case "pitchingWedge":
    case "gapWedge":
    case "sandWedge":
    case "lobWedge":
    case "wedge":
      return "wedge";
  }
}
