import type { Locale } from "../i18n/LocaleContext";
import type { TranslationKey } from "../i18n/locales/en";

// Matches useLocale()'s t() signature exactly — every function below takes
// this (and locale, where Intl needs it) as a plain parameter instead of
// calling the hook itself, since format.ts is a plain module, not a
// component, and is called from render bodies that already hold their own
// `t`/`locale` from useLocale().
type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export function formatDate(iso: string, locale: Locale, t: TFn): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(d, today)) return t("date.today");
  if (isSameDay(d, tomorrow)) return t("date.tomorrow");

  return d.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });
}

export function formatShortDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

// Compact "SAT · 10:20 AM" style day label for dense card layouts.
export function formatCompactDay(iso: string, locale: Locale, t: TFn): string {
  const label = formatDate(iso, locale, t);
  if (label === t("date.today") || label === t("date.tomorrow")) return label.toUpperCase();
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { weekday: "short" }).toUpperCase();
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(0)}`;
}

// BUDGET_PREF_MAX (300) is the slider's uncapped "+" ceiling — shown as
// "$300+" rather than a hard limit. noBudgetPreference is a distinct state
// from a literal $0 minimum, never collapsed into it.
export function formatBudgetRange(min: number, max: number, noPreference: boolean, t: TFn): string {
  if (noPreference) return t("budget.noPreference");
  const maxLabel = max >= 300 ? "$300+" : `$${max}`;
  return `$${min}–${maxLabel}`;
}

export function handicapLabel(handicap: number | null, t: TFn): string {
  if (handicap === null) return t("golfCallDetail.noHandicapYet");
  return t("golfCallDetail.handicapValue", { handicap });
}

export function skillTierFromHandicap(handicap: number | null): "Beginner" | "Intermediate" | "Advanced" {
  if (handicap === null || handicap > 20) return "Beginner";
  if (handicap > 10) return "Intermediate";
  return "Advanced";
}

export function monthsSince(iso: string): number {
  const start = new Date(iso);
  const now = new Date();
  return Math.max(
    0,
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()),
  );
}

export function memberSinceLabel(iso: string, t: TFn): string {
  const months = monthsSince(iso);
  if (months < 1) return t("member.new");
  if (months < 12) return t("member.months", { months });
  const years = Math.floor(months / 12);
  return years > 1 ? t("member.years", { years }) : t("member.year", { years });
}

export function isNewAccount(completedRounds: number): boolean {
  return completedRounds < 3;
}

// Compact relative timestamp for message previews/threads — "2m", "1h",
// "Yesterday", or a short date once it's more than a day old.
export function formatRelativeTime(iso: string, locale: Locale, t: TFn): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t("time.justNow");
  if (diffMin < 60) return t("time.minutesAgo", { minutes: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t("time.hoursAgo", { hours: diffHours });

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return t("date.yesterday");

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return d.toLocaleDateString(locale, { weekday: "short" });
  return formatShortDate(iso, locale);
}

export function paceLabel(goodPacePct: number, t: TFn): string {
  if (goodPacePct >= 90) return t("pace.quick");
  if (goodPacePct >= 70) return t("pace.medium");
  return t("pace.relaxed");
}
