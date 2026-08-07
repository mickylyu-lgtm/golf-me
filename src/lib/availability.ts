import type { AvailabilitySlot } from "../types";

function dayPartFromHour(hour: number): "Mornings" | "Afternoons" | "Evenings" {
  return hour < 12 ? "Mornings" : hour < 17 ? "Afternoons" : "Evenings";
}

export function currentAvailabilitySlot(): AvailabilitySlot {
  const now = new Date();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  return `${isWeekend ? "Weekend" : "Weekday"} ${dayPartFromHour(now.getHours())}` as AvailabilitySlot;
}

// Best-effort parse of a Golf Call's date + free-text time label (e.g.
// "10:00 AM", "5:30 PM Twilight") into the same day-part bucket used by
// golfer availability, so a round's slot can be compared against a
// golfer's stated free times.
export function callToAvailabilitySlot(dateISO: string, timeLabel: string): AvailabilitySlot {
  const date = new Date(dateISO);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  const match = timeLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hour = date.getHours();
  if (match) {
    hour = parseInt(match[1], 10) % 12;
    if (match[3].toUpperCase() === "PM") hour += 12;
  }

  return `${isWeekend ? "Weekend" : "Weekday"} ${dayPartFromHour(hour)}` as AvailabilitySlot;
}
