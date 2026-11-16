// Me (the Profile tab) shows Rounds | Swings | Posts under the profile
// header. Same pattern as Play's findTab: the last tab used is remembered for
// the session, and ?tab= asks for a specific one (the old /my-rounds and
// /profile/posts URLs redirect here with it).
export type ProfileTab = "rounds" | "swings" | "posts";

export const PROFILE_TABS: readonly ProfileTab[] = ["rounds", "swings", "posts"];
export const PROFILE_TAB_PARAM = "tab";
export const PROFILE_TAB_STORAGE_KEY = "golfme:profileTab";

export function isProfileTab(v: string | null | undefined): v is ProfileTab {
  return v === "rounds" || v === "swings" || v === "posts";
}

// The URL for Me opened on a specific tab.
export function profileTabPath(tab: ProfileTab): string {
  return `/profile?${PROFILE_TAB_PARAM}=${tab}`;
}

// An explicit, valid request wins; anything else keeps the remembered tab.
export function resolveProfileTab(requested: string | null | undefined, remembered: ProfileTab): ProfileTab {
  return isProfileTab(requested) ? requested : remembered;
}
