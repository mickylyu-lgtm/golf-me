import { coarsenGeoPoint } from "./coarseLocation.ts";

// The course map's "where am I" dot (Micky, 2026-11-07: the old blue dot
// "doesn't actually track real location" -- it was the browse area's centre,
// e.g. the New York, NY centroid in the harbour, drawn like a GPS dot).
//
// The live fix lives ONLY here and in the map marker that draws it: it is
// never put in React state, never passed to course search, never saved to
// the profile or session storage, and the watch stops when the map closes or
// the app goes to the background. Choosing an area for search still goes
// through LocationPicker, which rounds to ~1 km (lib/coarseLocation.ts).
//
// "exact" draws the device's real position with its accuracy circle, on this
// screen only. "coarse" rounds it to ~1 km first and draws a ~1 km circle
// instead of a precise point: the fallback if the exact on-screen dot is not
// wanted (privacy policy wording, see DEVELOPMENT_STATUS.md).
// No React or map imports, so tests/deviceLocation.test.ts runs under plain node.
export type DotPrecision = "exact" | "coarse";
export const DEVICE_DOT_PRECISION: DotPrecision = "exact";

// About what 2-decimal rounding can be off by (half a 0.01 deg cell
// diagonally is ~0.8 km; rounded up so the circle always covers the truth).
export const COARSE_ACCURACY_M = 1000;

export interface DeviceFix {
  lat: number;
  lng: number;
  // Radius of the circle the device is somewhere inside, in metres.
  accuracyM: number;
}

export function toDisplayFix(raw: DeviceFix, precision: DotPrecision): DeviceFix {
  const accuracyM = Number.isFinite(raw.accuracyM) && raw.accuracyM > 0 ? raw.accuracyM : 0;
  if (precision === "exact") return { lat: raw.lat, lng: raw.lng, accuracyM };
  const p = coarsenGeoPoint({ lat: raw.lat, lng: raw.lng });
  return { lat: p.lat, lng: p.lng, accuracyM: Math.max(accuracyM, COARSE_ACCURACY_M) };
}

// MapLibre's web-mercator scale (512 px tiles): metres per screen pixel at a
// latitude and zoom. Used to size the accuracy circle as the map zooms.
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
export function accuracyRadiusPx(accuracyM: number, lat: number, zoom: number): number {
  const metresPerPx = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  if (!(metresPerPx > 0) || !(accuracyM > 0)) return 0;
  return accuracyM / metresPerPx;
}

export type LocateProblem = "denied" | "unavailable" | "unsupported";

// GeolocationPositionError codes: 1 permission denied, 2 position
// unavailable, 3 timeout. Only "denied" ends the watch; the others keep
// listening (a fix can still arrive once the device finds the sky).
export function locateProblem(code: number): LocateProblem {
  return code === 1 ? "denied" : "unavailable";
}

export interface LocateCallbacks {
  onFix: (fix: DeviceFix) => void;
  onProblem: (problem: LocateProblem) => void;
}

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 };

// Starts watching the device position; returns the function that stops it.
export function watchDeviceLocation(
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch"> | undefined,
  precision: DotPrecision,
  { onFix, onProblem }: LocateCallbacks,
): () => void {
  if (!geolocation) {
    onProblem("unsupported");
    return () => {};
  }
  let stopped = false;
  let id: number | null = null;
  const stop = () => {
    stopped = true;
    if (id !== null) geolocation.clearWatch(id);
    id = null;
  };
  id = geolocation.watchPosition(
    (pos) => {
      if (stopped) return;
      onFix(toDisplayFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }, precision));
    },
    (err) => {
      if (stopped) return;
      const problem = locateProblem(err.code);
      if (problem === "denied") stop();
      onProblem(problem);
    },
    WATCH_OPTIONS,
  );
  // A denial reported synchronously (some engines) already stopped us.
  if (stopped && id !== null) {
    geolocation.clearWatch(id);
    id = null;
  }
  return stop;
}
