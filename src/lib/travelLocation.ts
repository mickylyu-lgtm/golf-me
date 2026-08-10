import type { GolferProfile } from "../types";
import type { PlayingArea } from "./geo";

// Same temporary-per-search-override pattern as matchPreferences.ts's
// effectiveNewPreferences — a "Playing Somewhere Else?" search never writes
// to the golfer's saved profile unless they explicitly tap "Set as My
// Default," so this reads from URL params first and only falls back to the
// saved playingArea when no override is present.
const PARAM_LABEL = "loc";
const PARAM_LAT = "locLat";
const PARAM_LNG = "locLng";

export function effectiveLocation(user: GolferProfile, params: URLSearchParams): PlayingArea {
  const label = params.get(PARAM_LABEL);
  if (!label) return { label: user.areaLabel, coords: user.playingAreaCoords };
  const lat = params.get(PARAM_LAT);
  const lng = params.get(PARAM_LNG);
  return { label, coords: lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined };
}

export function locationParams(area: PlayingArea): Record<string, string> {
  const params: Record<string, string> = { [PARAM_LABEL]: area.label };
  if (area.coords) {
    params[PARAM_LAT] = String(area.coords.lat);
    params[PARAM_LNG] = String(area.coords.lng);
  }
  return params;
}

export function isTemporaryLocation(user: GolferProfile, params: URLSearchParams): boolean {
  const label = params.get(PARAM_LABEL);
  return Boolean(label) && label !== user.areaLabel;
}
