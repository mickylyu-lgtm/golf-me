export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, tomorrow)) return "Tomorrow";

  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(0)}`;
}

export function handicapLabel(handicap: number | null): string {
  if (handicap === null) return "No handicap yet";
  if (handicap <= 5) return `${handicap} handicap`;
  return `${handicap} handicap`;
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

export function memberSinceLabel(iso: string): string {
  const months = monthsSince(iso);
  if (months < 1) return "New member";
  if (months < 12) return `${months} mo. on Golf Me`;
  const years = Math.floor(months / 12);
  return `${years} yr${years > 1 ? "s" : ""} on Golf Me`;
}

export function isNewAccount(completedRounds: number): boolean {
  return completedRounds < 3;
}
