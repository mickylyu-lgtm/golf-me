// Sent-time label for one chat message, shown when the DM list is swiped
// sideways (DirectMessageThread). The thread has no date separators, so
// anything older than today also gets a short day line above the time:
// "Yesterday", a weekday within the last week, then a short date (with the
// year once it's not this year). Plain module with no runtime imports so
// it can be unit-tested with node --test.

type TFn = (key: "date.yesterday") => string;

export interface MessageTimeLabel {
  // null for a message sent today: the time alone is enough.
  day: string | null;
  time: string;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatMessageTime(iso: string, locale: string, t: TFn, now: Date = new Date()): MessageTimeLabel | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  // Calendar-day difference in local time (DST-safe: rounds the 23h/25h days).
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  let day: string | null;
  if (days <= 0) day = null;
  else if (days === 1) day = t("date.yesterday");
  else if (days < 7) day = d.toLocaleDateString(locale, { weekday: "short" });
  else if (d.getFullYear() === now.getFullYear()) day = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  else day = d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });

  return { day, time };
}
