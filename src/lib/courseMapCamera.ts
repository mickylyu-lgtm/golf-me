// The course map's camera and selected pin, kept for the session so leaving
// the map (Host here, a tee-time page, the app's own Back) and coming back
// returns to the same view instead of a reset. No React or map imports, so
// tests/courseMapCamera.test.ts runs under plain node.

export interface MapCamera {
  // Which area this view was for; a different area starts fresh.
  areaId: string;
  lng: number;
  lat: number;
  zoom: number;
  selectedKey: string | null;
}

const KEY = "golfme:courseMapCamera";

export function saveMapCamera(camera: MapCamera): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(camera));
  } catch {
    // Storage blocked: the map just opens fresh next time.
  }
}

export function loadMapCamera(): MapCamera | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? parseMapCamera(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function parseMapCamera(value: unknown): MapCamera | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (typeof v.areaId !== "string" || !finite(v.lng) || !finite(v.lat) || !finite(v.zoom)) return null;
  if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180 || v.zoom < 0 || v.zoom > 24) return null;
  return {
    areaId: v.areaId,
    lng: v.lng,
    lat: v.lat,
    zoom: v.zoom,
    selectedKey: typeof v.selectedKey === "string" ? v.selectedKey : null,
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
