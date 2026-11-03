// Find > Golfers (Discover) filter state, kept in sessionStorage through
// useSessionState so Back from a golfer's profile and a Rounds/Golfers
// switch no longer reset it (both unmount Discover). useSessionState stores
// strings, so the vibe list is stored as a "|"-joined string.
import type { GolfVibe } from "../types/index.ts";
import { GOLF_VIBES } from "../types/index.ts";

export type SortMode = "compatibility" | "distance" | "reputation";

export const DISCOVER_VIBES_KEY = "golfme:discoverVibes";
export const DISCOVER_SORT_KEY = "golfme:discoverSort";
export const DISCOVER_FILTERS_OPEN_KEY = "golfme:discoverFiltersOpen";

export function isSortMode(v: string): v is SortMode {
  return v === "compatibility" || v === "distance" || v === "reputation";
}

export function isOpenFlag(v: string): v is "1" | "0" {
  return v === "1" || v === "0";
}

// Unknown entries are dropped, duplicates collapse, order follows GOLF_VIBES.
export function parseVibes(stored: string): GolfVibe[] {
  if (!stored) return [];
  const parts = new Set(stored.split("|"));
  return GOLF_VIBES.filter((v) => parts.has(v));
}

export function serializeVibes(vibes: readonly GolfVibe[]): string {
  return GOLF_VIBES.filter((v) => vibes.includes(v)).join("|");
}

export function toggleVibe(vibes: readonly GolfVibe[], v: GolfVibe): GolfVibe[] {
  return vibes.includes(v) ? vibes.filter((x) => x !== v) : [...vibes, v];
}
