// Find (the Play tab) has two sub-tabs. The last one used is remembered for
// the app session, which is right for a plain return to Play (bottom-nav
// tap, swipe, Back) -- but "Find a Round", "View more" and the Back
// fallback from a round page always mean Rounds, so they ask for it with
// ?tab=rounds and the request beats the remembered tab.
export type FindTab = "rounds" | "golfers";

export const FIND_TAB_PARAM = "tab";
export const FIND_TAB_STORAGE_KEY = "golfme:findTab";

export function isFindTab(v: string | null | undefined): v is FindTab {
  return v === "rounds" || v === "golfers";
}

// The URL for Play opened on a specific sub-tab.
export function findTabPath(tab: FindTab): string {
  return `/find?${FIND_TAB_PARAM}=${tab}`;
}

// The sub-tab to show: an explicit, valid request wins; anything else
// (no param, or a junk value) keeps the remembered one.
export function resolveFindTab(requested: string | null | undefined, remembered: FindTab): FindTab {
  return isFindTab(requested) ? requested : remembered;
}
