import { CircleUserRound, ClipboardList, Compass, Flag, Home, PlusCircle, Search } from "lucide-react";

// Desktop sidebar — unchanged from V1.
export const NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "Discover", path: "/discover", icon: Compass },
  { label: "Golf Calls", path: "/golf-calls", icon: Flag },
  { label: "My Rounds", path: "/my-rounds", icon: ClipboardList },
  { label: "Profile", path: "/profile", icon: CircleUserRound },
] as const;

// Mobile bottom nav — "Find" merges Golf Calls + Discover into one hub,
// "Create" jumps straight into hosting a round (incl. Fill My Foursome).
export const MOBILE_NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "Find", path: "/find", icon: Search },
  { label: "Create", path: "/golf-calls/new", icon: PlusCircle },
  { label: "My Golf", path: "/my-rounds", icon: ClipboardList },
  { label: "Profile", path: "/profile", icon: CircleUserRound },
] as const;
