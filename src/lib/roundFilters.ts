import type { GolfCall } from "../types";
import { isThisWeekend } from "./greeting";

// Shared "when" matching used by both the Golf Calls matched-browse view and
// Auto-Match, so the two entry points behave identically for the same
// wizard answers.
export function isSameCalendarDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export function matchesWhen(call: GolfCall, when: string | null, customDate: string | null): boolean {
  if (when === "today") return isSameCalendarDay(call.dateISO, new Date());
  if (when === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isSameCalendarDay(call.dateISO, tomorrow);
  }
  if (when === "weekend") return isThisWeekend(call.dateISO);
  if (when === "date" && customDate) return isSameCalendarDay(call.dateISO, new Date(`${customDate}T12:00:00`));
  return true;
}
