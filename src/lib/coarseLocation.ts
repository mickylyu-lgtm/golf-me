import type { GeoPoint } from "./geo";

// Location privacy: a golfer's playing area is readable by every signed-in
// account (golfer distance / discovery is computed client-side from it), so
// it must only ever be a general area, never a device-precise fix. 2 decimal
// places is ~1.1 km of latitude -- plenty for "golfers/courses near you", far
// too coarse to locate a home.
//
// The server enforces the same rounding on every profiles write
// (coarsen_profile_location trigger, 20260930 migration) -- this client-side
// copy exists so nothing precise leaves the device in the first place
// (profile saves AND course-search requests).
const COARSE_LOCATION_DECIMALS = 2;
const FACTOR = 10 ** COARSE_LOCATION_DECIMALS;

// Round half away from zero, matching Postgres round(numeric, 2) so a value
// rounded here comes back from the server unchanged. The tiny epsilon absorbs
// binary float error at exact .xx5 boundaries (e.g. 1.005 * 100 = 100.4999...).
function roundCoordinate(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * FACTOR + 1e-9)) / FACTOR;
}

export function coarsenGeoPoint(point: GeoPoint): GeoPoint {
  return { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) };
}

export function coarsenOptionalGeoPoint(point: GeoPoint | undefined): GeoPoint | undefined {
  return point ? coarsenGeoPoint(point) : undefined;
}
