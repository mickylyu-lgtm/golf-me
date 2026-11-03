// Which bottom/side nav tab a route belongs to. Re-exported from nav.ts;
// kept in its own file with no React/icon imports so tests/navMatch.test.ts
// runs under plain node --test.
//
// A tab is active on its own path and on every route listed for it, each
// matched as a whole path segment ("/find" covers "/find" and "/find/x",
// never "/findx"). Routes are grouped by what they are, not by where they
// were opened from: a round opened from a Home card is still a Play screen.
// Home ("/") is exact-only. Routes reached from several tabs (/golfer/:id,
// /community/*) belong to none, so the navs keep their existing fallback
// for them.
export const NAV_RELATED_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  "/": [],
  "/messages": ["/messages"],
  // Play merges Golf Calls (browse, host, detail), Golfers (/discover),
  // Auto-Match, Tee Times and course pages -- all of them reached from
  // Find or its Home shortcuts, none a nav destination of its own.
  "/find": ["/find", "/golf-calls", "/auto-match", "/discover", "/tee-times", "/courses"],
  "/caddie": ["/caddie"],
  // Me: the profile sub-pages plus the screens only reachable from Me
  // (Settings and its Help/About, My Golf, saved posts, coach reviews).
  "/profile": ["/profile", "/settings", "/help", "/about", "/my-rounds", "/saved-posts", "/coach-reviews"],
};

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Is the nav tab whose path is `navPath` the active one for `pathname`?
export function isNavPathActive(navPath: string, pathname: string): boolean {
  if (navPath === "/") return pathname === "/";
  const prefixes = NAV_RELATED_PREFIXES[navPath] ?? [navPath];
  return prefixes.some((p) => underPrefix(pathname, p));
}

// Index of the active tab in `items`, or -1 when the route belongs to none
// (callers keep their own fallback for that case).
export function activeNavIndex(items: readonly { path: string }[], pathname: string): number {
  return items.findIndex((item) => isNavPathActive(item.path, pathname));
}
