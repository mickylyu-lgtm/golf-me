// The area a golfer is browsing courses in (Nearby Courses list, course
// map) when it isn't their saved playing area. Kept in the current history
// entry's state, so opening a course and coming Back finds the same area
// instead of resetting to the saved one; the saved home location is never
// changed by browsing. No React imports, so tests/browseArea.test.ts runs
// under plain node.
import type { PlayingArea } from "./geo";

// The history state to replace the current entry's with after picking an
// area: everything else on the entry is kept (e.g. the map's open sheet).
export function withBrowseArea<T extends object>(state: T | null | undefined, area: PlayingArea): T & { area: PlayingArea } {
  return { ...(state ?? ({} as T)), area };
}

// The area to start with: the one this entry was browsing, else the saved one.
export function initialBrowseArea(state: unknown, saved: PlayingArea | undefined): PlayingArea | undefined {
  const area = (state as { area?: PlayingArea } | null)?.area;
  return area?.coords ? area : saved;
}
