// Caddie "Saved swings": the categories, grouping and the small pieces of
// plumbing around the saved_at column (migration 20261107210000). The
// caddie_analyses row is the source of truth for real accounts; demo keeps
// its saves in localStorage (DataContext). No React imports, so
// tests/caddieSaved.test.ts runs under plain node --test.
import { CLUB_CATEGORIES, clubCategoryOf } from "./clubCatalog.ts";
import type { ClubCategory } from "./clubCatalog.ts";
import type { TranslationKey } from "../i18n/locales/en";

/** The picker's five cards, plus "other" for no club, "Not sure" or anything typed that isn't a club. */
export type SavedCategory = ClubCategory | "other";
export type SavedFilter = "all" | SavedCategory;

export const SAVED_CATEGORIES: readonly SavedCategory[] = [...CLUB_CATEGORIES, "other"];

export const SAVED_FILTER_KEYS: Record<SavedFilter, TranslationKey> = {
  all: "caddie.saved.filter.all",
  driver: "caddie.saved.filter.driver",
  wood: "caddie.saved.filter.wood",
  hybrid: "caddie.saved.filter.hybrid",
  iron: "caddie.saved.filter.iron",
  wedge: "caddie.saved.filter.wedge",
  other: "caddie.saved.filter.other",
};

export function savedCategoryOf(swingType: string | null | undefined): SavedCategory {
  return clubCategoryOf(swingType) ?? "other";
}

interface Saveable {
  id: string;
  status: string;
  swingType?: string;
  savedAt?: string;
}

/** Only a complete analysis can be saved (the database enforces the same rule). */
export function canSaveAnalysis(a: Pick<Saveable, "status">): boolean {
  return a.status === "complete";
}

/** Saved complete analyses, most recently saved first. */
export function savedAnalyses<T extends Saveable>(analyses: readonly T[]): T[] {
  return analyses
    .filter((a) => !!a.savedAt && canSaveAnalysis(a))
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
}

export function savedCounts(saved: readonly Pick<Saveable, "swingType">[]): Record<SavedFilter, number> {
  const counts: Record<SavedFilter, number> = { all: saved.length, driver: 0, wood: 0, hybrid: 0, iron: 0, wedge: 0, other: 0 };
  for (const a of saved) counts[savedCategoryOf(a.swingType)] += 1;
  return counts;
}

/** "All" first, then only the categories that have something in them. */
export function visibleSavedFilters(counts: Record<SavedFilter, number>): SavedFilter[] {
  return ["all", ...SAVED_CATEGORIES.filter((c) => counts[c] > 0)];
}

export function filterSaved<T extends Pick<Saveable, "swingType">>(saved: readonly T[], filter: SavedFilter): T[] {
  return filter === "all" ? [...saved] : saved.filter((a) => savedCategoryOf(a.swingType) === filter);
}

/**
 * The list select names saved_at; on a database without the column yet,
 * PostgREST answers 42703 (undefined column in a select) or PGRST204.
 * The app then reads the list without it and hides Save.
 */
export function isMissingSavedColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (err.code === "42703" || err.code === "PGRST204") && (err.message ?? "").includes("saved_at");
}

// ---- Demo: saves kept on this device only (fixture data, nothing personal) ----

export const DEMO_SAVED_KEY = "golfme:demoCaddieSaved";

/** analysis id -> ISO saved time. Empty when storage is unavailable or holds junk. */
export function loadDemoSaved(storage: Pick<Storage, "getItem"> | undefined): Record<string, string> {
  try {
    const raw = storage?.getItem(DEMO_SAVED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "string" && !Number.isNaN(Date.parse(at))) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

export function storeDemoSaved(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, saved: Record<string, string>): void {
  try {
    if (Object.keys(saved).length === 0) storage?.removeItem(DEMO_SAVED_KEY);
    else storage?.setItem(DEMO_SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable: the save lasts for this visit only.
  }
}
