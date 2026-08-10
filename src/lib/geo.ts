// General location math shared by the whole app — general area/coordinate
// pairs only (city/region granularity), never an exact address. See
// GolferProfile.playingAreaCoords and data/regions.ts.
export interface GeoPoint {
  lat: number;
  lng: number;
}

// A user's general playing area — city/region label, optionally with
// coordinates (present when picked from a known region or real
// geolocation; absent for free-typed labels with no match). Shared shape
// for both a golfer's saved default and any temporary per-search override.
export interface PlayingArea {
  label: string;
  coords?: GeoPoint;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance — accurate enough for "how far is this course from
// your selected area" at city/region scale; no need for anything fancier
// in a prototype with no real mapping/routing API.
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistanceMiles(mi: number): string {
  if (mi < 1) return "<1 mi";
  return `${mi.toFixed(0)} mi`;
}
