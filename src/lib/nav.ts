import { Flag, Home, Sparkles, User } from "lucide-react";
import type { TranslationKey } from "../i18n/locales/en";

// Home / Play / Caddie / Me — "Play" is the old "Find" (still merges Golf
// Calls + Discover + Tee Times + Auto-Match + Host a Round, all reached
// from within it, none of them a separate nav destination). "Me" is the
// old "Profile"; My Golf moved off the bottom nav entirely and is now a
// row on the Me page (see Profile.tsx) rather than its own tab, since 4
// slots don't stretch to 5 — Caddie earned the tab My Golf gave up.
// labelKey (not a literal label) so BottomNav/SideNav can translate it via
// t() at render time.
export const NAV_ITEMS: { labelKey: TranslationKey; path: string; icon: typeof Home }[] = [
  { labelKey: "nav.home", path: "/", icon: Home },
  { labelKey: "nav.play", path: "/find", icon: Flag },
  { labelKey: "nav.caddie", path: "/caddie", icon: Sparkles },
  { labelKey: "nav.me", path: "/profile", icon: User },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS;
