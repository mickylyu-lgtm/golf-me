import type { TranslationKey } from "../i18n/locales/en";

// 05:00-11:59 Morning, 12:00-17:59 Afternoon, 18:00-04:59 Evening — the
// wrap past midnight matters here: hour < 5 must still read as evening/
// night, not fall through to "morning" just because it's numerically small.
export function greetingKeyForHour(hour: number): TranslationKey {
  if (hour >= 5 && hour < 12) return "greeting.morning";
  if (hour >= 12 && hour < 18) return "greeting.afternoon";
  return "greeting.evening";
}

export function firstName(fullName: string): string {
  return fullName.split(" ")[0];
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// "This weekend" = the current or upcoming Saturday through end of Sunday.
export function getWeekendRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  let start: Date;
  if (day === 6) start = startOfDay(now);
  else if (day === 0) start = startOfDay(addDays(now, -1));
  else start = startOfDay(addDays(now, 6 - day));
  const end = addDays(start, 2); // exclusive end (Monday 00:00)
  return { start, end };
}

export function isThisWeekend(dateISO: string): boolean {
  const { start, end } = getWeekendRange();
  const d = new Date(dateISO);
  return d >= start && d < end;
}
