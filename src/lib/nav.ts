import { CircleUserRound, ClipboardList, Home, Search } from "lucide-react";
import type { TranslationKey } from "../i18n/locales/en";

// Same 4 root sections on desktop and mobile — "Find" merges Golf Calls +
// Discover into one hub; hosting a round is reached via a "Host a Round"
// action inside Home/Find/My Golf rather than living as its own permanent
// nav destination (it's an action, not a place). labelKey (not a literal
// label) so BottomNav/SideNav can translate it via t() at render time.
export const NAV_ITEMS: { labelKey: TranslationKey; path: string; icon: typeof Home }[] = [
  { labelKey: "nav.home", path: "/", icon: Home },
  { labelKey: "nav.find", path: "/find", icon: Search },
  { labelKey: "nav.myGolf", path: "/my-rounds", icon: ClipboardList },
  { labelKey: "nav.profile", path: "/profile", icon: CircleUserRound },
];

export const MOBILE_NAV_ITEMS = NAV_ITEMS;
