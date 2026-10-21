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

// ---------------------------------------------------------------------------
// Localized city names (global hosting Phase 2, items 3-4).
//
// A profile stores the canonical place (playing_area_place_id + country code
// + zone + coarse coords) and an English area_label fallback. The city's name
// in every GolfMe language lives once per PLACE, not per profile, in
// public.geo_places (names jsonb keyed by PLACE_NAME_KEYS), filled by
// course-search `mode: "place"` from one Geoapify Place Details request with
// the `details.names` feature (2 credits per new distinct city, ever; see
// docs/GLOBAL_HOSTING.md). Country names never need the network: the client
// uses Intl.DisplayNames. Built-in regions ship their names in the bundle
// (src/data/regionNames.ts).
// ---------------------------------------------------------------------------

/** Keys of geo_places.names. zh-CN reads zh-Hans, zh-TW reads zh-Hant. */
export const PLACE_NAME_KEYS = ["en", "es", "ja", "ko", "zh-Hans", "zh-Hant"] as const;
export type PlaceNameKey = (typeof PLACE_NAME_KEYS)[number];
export type PlaceNames = Partial<Record<PlaceNameKey, string>>;

/** State/province code shape (NY, ON, NSW). Same as the geo_places CHECK. */
export const REGION_CODE_RE = /^[A-Z0-9]{1,3}$/;

/** Row/wire shape of public.geo_places and course-search `mode: "place"`. */
export interface PlaceNamesDto {
  placeId: string; // "geoapify:<id>"
  names: PlaceNames;
  countryCode: string | null;
  regionCode: string | null;
}

/** App locale to the geo_places.names key it reads first. */
export function placeNameKeyForLocale(locale: unknown): PlaceNameKey {
  if (typeof locale !== "string") return "en";
  const l = locale.toLowerCase();
  if (l === "zh-tw" || l === "zh-hk" || l === "zh-hant" || l.startsWith("zh-hant")) return "zh-Hant";
  if (l.startsWith("zh")) return "zh-Hans";
  const base = l.split("-")[0];
  return (PLACE_NAME_KEYS as readonly string[]).includes(base) ? (base as PlaceNameKey) : "en";
}

/** "geoapify:<raw>" to the raw Geoapify id, or null for anything else. */
export function geoapifyRawPlaceId(placeId: unknown): string | null {
  if (typeof placeId !== "string" || !PLACE_ID_RE.test(placeId) || !placeId.startsWith("geoapify:")) return null;
  const raw = placeId.slice("geoapify:".length);
  return GEOAPIFY_RAW_ID_RE.test(raw) ? raw : null;
}

/** Geoapify Place Details params (apiKey added by the caller). English base
 * name plus the `details.names` feature (international names). */
export function geoapifyPlaceDetailsParams(rawId: string): URLSearchParams {
  return new URLSearchParams({ id: rawId, lang: "en", features: "details,details.names" });
}

// OSM-style name_international keys we accept for each GolfMe key, in order.
const NAME_SOURCE_KEYS: Record<PlaceNameKey, string[]> = {
  en: ["en"],
  es: ["es"],
  ja: ["ja"],
  ko: ["ko"],
  "zh-Hans": ["zh-Hans", "zh-CN", "zh_Hans", "zh"],
  "zh-Hant": ["zh-Hant", "zh-TW", "zh-HK", "zh_Hant"],
};

function cleanName(v: unknown): string | undefined {
  const s = str(v);
  if (!s || Array.from(s).length > MAX_LABEL_CHARS) return undefined;
  return s;
}

/** Keeps only GolfMe's 6 keys, each a short normalized string. */
export function sanitizePlaceNames(raw: unknown): PlaceNames {
  const out: PlaceNames = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const key of PLACE_NAME_KEYS) {
    const name = cleanName(r[key]);
    if (name) out[key] = name;
  }
  return out;
}

/**
 * Maps a Geoapify Place Details response (GeoJSON FeatureCollection) to the
 * names of one city. Returns null when nothing usable came back. Never reads
 * or returns coordinates: the profile already holds the coarse point.
 */
export function mapGeoapifyPlaceDetails(raw: unknown, placeId: string): PlaceNamesDto | null {
  if (!geoapifyRawPlaceId(placeId)) return null;
  const features = (raw as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return null;
  // The "details" feature is the place itself; ignore any others.
  const feature = features.find((f) => (f as { properties?: { feature_type?: unknown } })?.properties?.feature_type === "details") ?? features[0];
  const props = (feature as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props || typeof props !== "object") return null;

  const intl = props.name_international && typeof props.name_international === "object" ? (props.name_international as Record<string, unknown>) : {};
  const names: PlaceNames = {};
  for (const key of PLACE_NAME_KEYS) {
    for (const source of NAME_SOURCE_KEYS[key]) {
      const name = cleanName(intl[source]);
      if (name) {
        names[key] = name;
        break;
      }
    }
  }
  // lang=en, so the base name/city is the English (or local, when OSM has no
  // English) name -- the right fallback for "en".
  if (!names.en) {
    const base = cleanName(props.city) ?? cleanName(props.name);
    if (base) names.en = base;
  }
  if (!names.en) return null;

  const cc = str(props.country_code)?.toLowerCase();
  const rc = str(props.state_code)?.toUpperCase();
  return {
    placeId,
    names,
    countryCode: cc && COUNTRY_CODE_RE.test(cc) ? cc : null,
    regionCode: rc && REGION_CODE_RE.test(rc) ? rc : null,
  };
}

/** Re-validates a geo_places row or a `mode: "place"` response. */
export function sanitizePlaceNamesDto(raw: unknown): PlaceNamesDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const placeId = r.placeId ?? r.place_id;
  if (typeof placeId !== "string" || !PLACE_ID_RE.test(placeId)) return null;
  const names = sanitizePlaceNames(r.names);
  if (!names.en) return null;
  const cc = r.countryCode ?? r.country_code;
  const rc = r.regionCode ?? r.region_code;
  return {
    placeId,
    names,
    countryCode: typeof cc === "string" && COUNTRY_CODE_RE.test(cc) ? cc : null,
    regionCode: typeof rc === "string" && REGION_CODE_RE.test(rc) ? rc : null,
  };
}
