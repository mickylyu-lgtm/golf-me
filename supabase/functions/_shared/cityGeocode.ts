// City geocoding helpers shared by the course-search Edge Function (Deno) and
// the web client (Vite). Pure TypeScript: no Deno/Node/DOM-only APIs beyond
// TextEncoder and crypto.subtle, which all three runtimes have. Unit-tested in
// src/lib/cityGeocode.test.ts.
//
// Privacy rules this file enforces:
//   - every coordinate that leaves it is rounded to 2 dp (~1.1 km), matching
//     src/lib/coarseLocation.ts and the profiles_coarsen_location trigger;
//   - the proximity bias a client sends is rounded to whole degrees (~100 km)
//     before it reaches Geoapify or the cache key;
//   - the cache key is a SHA-256 hash, so a typed query (which could be an
//     address) is never stored as text.

/** Minimum query length before the geocoder is called (Latin scripts). */
export const GEOCODE_MIN_CHARS = 3;
/** CJK/Hangul city names are often 2 characters (東京, 서울, 香港). */
export const GEOCODE_MIN_CHARS_CJK = 2;
export const GEOCODE_MAX_CHARS = 80;
export const GEOCODE_RESULT_LIMIT = 6;
/** Geoapify `lang` values for GolfMe's 6 locales (zh-CN and zh-TW both map to zh). */
export const GEOCODE_LANGS = ["en", "es", "ja", "ko", "zh"] as const;
export type GeocodeLang = (typeof GEOCODE_LANGS)[number];

// Same shapes as the CHECK constraints in
// supabase/migrations/20261021120000_profiles_playing_area_place_and_geocode.sql.
export const PLACE_ID_RE = /^(geoapify|golfme):[A-Za-z0-9_-]{1,200}$/;
export const COUNTRY_CODE_RE = /^[a-z]{2}$/;
export const TIMEZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const GEOAPIFY_RAW_ID_RE = /^[A-Za-z0-9_-]{1,190}$/;
const MAX_LABEL_CHARS = 80;

// Han, Hiragana, Katakana, Hangul.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

/** Wire shape returned by course-search `mode: "geocode"`. */
export interface CityPlaceDto {
  placeId: string; // "geoapify:<id>"
  label: string;
  lat: number; // 2 dp
  lng: number; // 2 dp
  countryCode: string | null;
  timezone: string | null;
}

export interface GeocodeRequest {
  /** Trimmed, whitespace-collapsed, NFKC; original case (sent to Geoapify). */
  query: string;
  /** Lowercased `query`, used for the cache key. */
  normalized: string;
  lang: GeocodeLang;
  /** Whole-degree proximity bias, or undefined. */
  bias?: { lat: number; lng: number };
}

export function normalizeGeocodeText(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function isGeocodeQueryEligible(raw: string): boolean {
  const q = normalizeGeocodeText(raw);
  const length = Array.from(q).length;
  if (length > GEOCODE_MAX_CHARS) return false;
  return length >= (CJK_RE.test(q) ? GEOCODE_MIN_CHARS_CJK : GEOCODE_MIN_CHARS);
}

/** App locale ("zh-TW", "en", ...) to a Geoapify lang. Unknown -> "en". */
export function geocodeLangForLocale(locale: unknown): GeocodeLang {
  if (typeof locale !== "string") return "en";
  const base = locale.toLowerCase().split("-")[0];
  return (GEOCODE_LANGS as readonly string[]).includes(base) ? (base as GeocodeLang) : "en";
}

/** Round half away from zero to `decimals`, matching Postgres round(numeric, n). */
export function roundCoordinate(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validLatLng(lat: unknown, lng: unknown): lat is number {
  return isFiniteNumber(lat) && isFiniteNumber(lng) && Math.abs(lat) <= 90 && Math.abs(lng as number) <= 180;
}

export type GeocodeValidation = { ok: true; value: GeocodeRequest } | { ok: false; error: string };

/** Validates the untrusted request body for `mode: "geocode"`. */
export function validateGeocodeRequest(body: unknown): GeocodeValidation {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.query !== "string") return { ok: false, error: "query required for geocode." };
  const query = normalizeGeocodeText(b.query);
  if (Array.from(query).length > GEOCODE_MAX_CHARS) return { ok: false, error: "query too long." };
  if (!isGeocodeQueryEligible(query)) return { ok: false, error: "query too short." };
  const lang = geocodeLangForLocale(b.lang);
  let bias: GeocodeRequest["bias"];
  if (b.biasLat != null || b.biasLng != null) {
    if (!validLatLng(b.biasLat, b.biasLng)) return { ok: false, error: "invalid bias." };
    // +0 turns a rounded -0 into 0 so the cache key is stable.
    bias = { lat: roundCoordinate(b.biasLat, 0) + 0, lng: roundCoordinate(b.biasLng as number, 0) + 0 };
  }
  return { ok: true, value: { query, normalized: query.toLowerCase(), lang, bias } };
}

/** Deterministic SHA-256 hex key; bump the "v1" prefix if the result shape changes. */
export async function geocodeCacheKey(req: GeocodeRequest): Promise<string> {
  const bias = req.bias ? `${req.bias.lat},${req.bias.lng}` : "-";
  const input = `v1|${req.lang}|${bias}|${req.normalized}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Geoapify autocomplete query parameters (apiKey added by the caller). */
export function geoapifyAutocompleteParams(req: GeocodeRequest): URLSearchParams {
  const params = new URLSearchParams({
    text: req.query,
    type: "city",
    format: "json",
    lang: req.lang,
    limit: String(GEOCODE_RESULT_LIMIT),
  });
  if (req.bias) params.set("bias", `proximity:${req.bias.lng},${req.bias.lat}`);
  return params;
}

// The subset of a Geoapify autocomplete `format=json` result we read. Field
// names verified against apidocs.geoapify.com (address-autocomplete) on
// 2026-10-20: country_code, state_code, timezone.name, lat/lon, city, name.
// place_id is returned by the live API but not listed on that docs page.
interface GeoapifyAutocompleteResult {
  place_id?: unknown;
  name?: unknown;
  city?: unknown;
  state?: unknown;
  state_code?: unknown;
  country?: unknown;
  country_code?: unknown;
  lat?: unknown;
  lon?: unknown;
  timezone?: { name?: unknown } | null;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = normalizeGeocodeText(v);
  return t || undefined;
}

// US/Canada/Australia read naturally as "City, ST" (matches "New York, NY" in
// the built-in list); elsewhere "City, Country", or just the name for a
// city-state (Hong Kong, Singapore) where both are the same.
const STATE_CODE_COUNTRIES = new Set(["us", "ca", "au"]);

export function cityLabel(r: { name?: string; state?: string; stateCode?: string; country?: string; countryCode?: string }): string | undefined {
  const name = r.name;
  if (!name) return undefined;
  let label: string;
  if (r.countryCode && STATE_CODE_COUNTRIES.has(r.countryCode) && r.stateCode) label = `${name}, ${r.stateCode.toUpperCase()}`;
  else if (r.country && r.country.toLowerCase() !== name.toLowerCase()) label = `${name}, ${r.country}`;
  else label = name;
  return Array.from(label).slice(0, MAX_LABEL_CHARS).join("");
}

/** Maps Geoapify autocomplete results to coarsened, validated city places. */
export function mapGeoapifyResults(raw: unknown): CityPlaceDto[] {
  const list = Array.isArray(raw) ? (raw as GeoapifyAutocompleteResult[]) : [];
  const out: CityPlaceDto[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const rawId = typeof r.place_id === "string" ? r.place_id : undefined;
    if (!rawId || !GEOAPIFY_RAW_ID_RE.test(rawId)) continue;
    if (!validLatLng(r.lat, r.lon)) continue;
    const countryCode = str(r.country_code)?.toLowerCase();
    const label = cityLabel({
      name: str(r.city) ?? str(r.name),
      state: str(r.state),
      stateCode: str(r.state_code),
      country: str(r.country),
      countryCode,
    });
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tz = str(r.timezone?.name);
    out.push({
      placeId: `geoapify:${rawId}`,
      label,
      lat: roundCoordinate(r.lat),
      lng: roundCoordinate(r.lon as number),
      countryCode: countryCode && COUNTRY_CODE_RE.test(countryCode) ? countryCode : null,
      timezone: tz && tz.length <= 64 && TIMEZONE_RE.test(tz) ? tz : null,
    });
  }
  return out.slice(0, GEOCODE_RESULT_LIMIT);
}

/**
 * Re-validates a geocode response on the receiving side (client, or a cache
 * read). Drops anything malformed and re-coarsens coordinates, so a bad cache
 * row or proxy can never put a precise point or an invalid id into a profile.
 */
export function sanitizeCityPlaces(raw: unknown): CityPlaceDto[] {
  if (!Array.isArray(raw)) return [];
  const out: CityPlaceDto[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.placeId !== "string" || !PLACE_ID_RE.test(p.placeId)) continue;
    const label = str(p.label);
    if (!label || Array.from(label).length > MAX_LABEL_CHARS) continue;
    if (!validLatLng(p.lat, p.lng)) continue;
    const cc = typeof p.countryCode === "string" && COUNTRY_CODE_RE.test(p.countryCode) ? p.countryCode : null;
    const tz = typeof p.timezone === "string" && p.timezone.length <= 64 && TIMEZONE_RE.test(p.timezone) ? p.timezone : null;
    out.push({ placeId: p.placeId, label, lat: roundCoordinate(p.lat), lng: roundCoordinate(p.lng as number), countryCode: cc, timezone: tz });
  }
  return out.slice(0, GEOCODE_RESULT_LIMIT);
}
