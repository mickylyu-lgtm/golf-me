// Satellite image of any course from its coordinates (Micky, 2026-10-23:
// every nearby course should open a page with at least an image). Mapbox
// Static Images API, satellite-v9 style (imagery only, no labels).
//
// VITE_MAPBOX_TOKEN is a Mapbox *public* token (pk.*), safe in the bundle by
// design and URL-restricted to GolfMe's domains in the Mapbox dashboard.
// Never put a secret (sk.*) token here. Unset -> null, and callers fall back
// to CourseHero's generic illustration.
//
// Mapbox's terms require its logo and attribution on the image; the Static
// Images API draws both into the picture by default (bottom-left logo,
// bottom-right text), so nothing is stripped here. Images are only ever
// hotlinked, never cached or stored by GolfMe.

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || undefined;

// ~1.5 km across at the hero's width: a typical 18-hole course plus a
// little of its surroundings.
const HERO_ZOOM = 15;

export function courseSatelliteImageUrl(lat: number | undefined, lng: number | undefined): string | null {
  if (!TOKEN || lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const center = `${lng.toFixed(5)},${lat.toFixed(5)},${HERO_ZOOM},0`;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center}/640x360@2x?access_token=${encodeURIComponent(TOKEN)}`;
}
