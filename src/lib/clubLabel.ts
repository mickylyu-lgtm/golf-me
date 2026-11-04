// Club names are stored in English (caddie_analyses.swing_type, see
// AnalyzeSwing's CLUB_OPTIONS) so the value stays stable across locales,
// and older rows hold whatever golfers typed ("3 wood", "4 hybrid"). This
// turns a stored name into the current language for display only (Micky,
// 2026-11-03: "the club selection is not translated"). Anything it can't
// read is shown exactly as stored. No React imports, so
// tests/clubLabel.test.ts runs under plain node --test.
import type { TranslationKey } from "../i18n/locales/en";

export type ParsedClub =
  | { kind: "driver" }
  | { kind: "wood" | "hybrid" | "iron"; n: number }
  | { kind: "pitchingWedge" }
  | { kind: "wedge"; degrees: number };

export function parseClub(raw: string | null | undefined): ParsedClub | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === "driver") return { kind: "driver" };
  if (s === "pitching wedge" || s === "pw") return { kind: "pitchingWedge" };
  const numbered = /^(\d{1,2}) ?(wood|hybrid|iron)$/.exec(s);
  if (numbered) return { kind: numbered[2] as "wood" | "hybrid" | "iron", n: Number(numbered[1]) };
  const wedge = /^(\d{2}) ?°? ?(wedge)$/.exec(s);
  if (wedge) return { kind: "wedge", degrees: Number(wedge[1]) };
  return null;
}

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function clubLabel(raw: string | null | undefined, t: T): string {
  const club = parseClub(raw);
  if (!club) return (raw ?? "").trim();
  switch (club.kind) {
    case "driver":
      return t("club.driver");
    case "pitchingWedge":
      return t("club.pitchingWedge");
    case "wedge":
      return t("club.wedge", { degrees: club.degrees });
    case "wood":
      return t("club.wood", { n: club.n });
    case "hybrid":
      return t("club.hybrid", { n: club.n });
    case "iron":
      return t("club.iron", { n: club.n });
  }
}
