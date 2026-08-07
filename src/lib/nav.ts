import { CircleUserRound, ClipboardList, Compass, Flag, Home } from "lucide-react";

export const NAV_ITEMS = [
  { label: "Home", path: "/", icon: Home },
  { label: "Discover", path: "/discover", icon: Compass },
  { label: "Golf Calls", path: "/golf-calls", icon: Flag },
  { label: "My Rounds", path: "/my-rounds", icon: ClipboardList },
  { label: "Profile", path: "/profile", icon: CircleUserRound },
] as const;
