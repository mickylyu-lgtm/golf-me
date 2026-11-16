import type { TranslationKey } from "../i18n/locales/en";

// "What's new" banner (Micky, 2026-11-16): after a visible change, the next
// app open shows a short, dismissible list of what changed.
//
// To announce a change: replace CURRENT_WHATS_NEW with a new entry (a new
// `id`, `publishedAt` = the ship date, 2-4 short item keys in all 6
// locales). A new id shows the banner again to everyone, including people
// who closed the previous one. Leave `null` when there's nothing to say.
export interface WhatsNewEntry {
  /** Unique per announcement; closing the banner stores this id. */
  id: string;
  /** ISO date the change shipped. Accounts created after it never see it (nothing changed for them). */
  publishedAt: string;
  /** Days after publishedAt that the banner stops showing on its own. */
  showForDays: number;
  items: TranslationKey[];
}

export const CURRENT_WHATS_NEW: WhatsNewEntry | null = {
  id: "2026-11-16-home-feed",
  publishedAt: "2026-11-16",
  showForDays: 14,
  items: ["whatsNew.item.homeFeed", "whatsNew.item.profileTabs", "whatsNew.item.playCourses", "whatsNew.item.following"],
};

export const WHATS_NEW_DISMISSED_KEY = "golfme:whatsNewDismissed";

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldShowWhatsNew(
  entry: WhatsNewEntry | null,
  opts: { dismissedId: string | null; now: number; memberSince?: string | null },
): boolean {
  if (!entry || entry.items.length === 0) return false;
  if (opts.dismissedId === entry.id) return false;
  const published = Date.parse(entry.publishedAt);
  if (Number.isNaN(published)) return false;
  if (opts.now > published + entry.showForDays * DAY_MS) return false;
  // Someone who joined after the change never saw the old version.
  // Compared by calendar day so a same-day signup still counts as new.
  const joined = opts.memberSince ? Date.parse(opts.memberSince.slice(0, 10)) : NaN;
  if (!Number.isNaN(joined) && joined > published) return false;
  return true;
}

export function readDismissedWhatsNew(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function storeDismissedWhatsNew(id: string): void {
  try {
    window.localStorage.setItem(WHATS_NEW_DISMISSED_KEY, id);
  } catch {
    // Private mode or full storage: it simply shows again next launch.
  }
}
