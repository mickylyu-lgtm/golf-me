// Auto-Match golfer suggestions for a "Playing Somewhere Else?" search area.
// Pure rules (no React/Supabase), tested by tests/travelGolfers.test.ts.
//
// Real golfers carry only a distance bucket measured from the caller's SAVED
// area (golfer_directory). Those buckets say nothing about a temporary
// search area: with a NYC home and an LA search, NYC golfers read "within 5
// mi" and LA golfers "50+ mi". So a temporary area uses buckets the server
// measured from that area (golfer_directory_from, migration 20261106130100),
// and when the server can't do that yet, no golfer suggestions are shown at
// all rather than home-based ones presented as nearby. The temporary area
// lives only in the URL; nothing here ever writes the saved area.

export type TravelDirectoryStatus = "idle" | "loading" | "ready" | "unsupported" | "error";

/**
 * Where Auto-Match's golfer distances come from:
 * - "home": no temporary area; the saved-area directory (as before).
 * - "local": demo golfers, whose fixture coordinates measure straight from
 *   the temporary area (no server involved).
 * - "travel": the server's buckets from the temporary area.
 * - "pending": that fetch hasn't answered yet.
 * - "hidden": a temporary area the server can't measure from (migration not
 *   applied, the request failed, or the area has no coordinates): show no
 *   golfers and say why.
 */
export type GolferDistanceSource = "home" | "local" | "travel" | "pending" | "hidden";

export function golferDistanceSource(input: {
  temporaryArea: boolean;
  isDemo: boolean;
  areaHasCoords: boolean;
  travelStatus: TravelDirectoryStatus;
}): GolferDistanceSource {
  if (!input.temporaryArea) return "home";
  if (input.isDemo) return "local";
  if (!input.areaHasCoords) return "hidden";
  switch (input.travelStatus) {
    case "ready":
      return "travel";
    case "idle":
    case "loading":
      return "pending";
    default:
      return "hidden";
  }
}

/** Golfers to rank for each source; [] whenever their distances would be wrong. */
export function golfersForSource<G>(source: GolferDistanceSource, home: readonly G[], travel: readonly G[]): G[] {
  if (source === "home" || source === "local") return [...home];
  if (source === "travel") return [...travel];
  return [];
}
