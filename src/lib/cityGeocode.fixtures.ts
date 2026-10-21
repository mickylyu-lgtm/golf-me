// Synthetic Geoapify Address Autocomplete (`format=json`) results for unit
// tests -- shaped like the real API, no network. Coordinates are well-known
// public city-centre centroids (4 dp), never a person's location; place_ids
// are made up.

export interface FixtureCity {
  key: "nyc" | "hongkong" | "tokyo" | "seoul" | "london" | "auckland";
  raw: Record<string, unknown>;
  expected: { label: string; lat: number; lng: number; countryCode: string; timezone: string };
}

export const FIXTURE_CITIES: FixtureCity[] = [
  {
    key: "nyc",
    raw: {
      place_id: "51synthNYC0001",
      name: "New York",
      city: "New York",
      state: "New York",
      state_code: "NY",
      country: "United States",
      country_code: "us",
      lat: 40.7127,
      lon: -74.0059,
      result_type: "city",
      timezone: { name: "America/New_York", offset_STD: "-05:00", abbreviation_STD: "EST" },
    },
    expected: { label: "New York, NY", lat: 40.71, lng: -74.01, countryCode: "us", timezone: "America/New_York" },
  },
  {
    key: "hongkong",
    raw: {
      place_id: "51synthHKG0001",
      name: "Hong Kong",
      city: "Hong Kong",
      country: "Hong Kong",
      country_code: "hk",
      lat: 22.3193,
      lon: 114.1694,
      result_type: "city",
      timezone: { name: "Asia/Hong_Kong", offset_STD: "+08:00" },
    },
    expected: { label: "Hong Kong", lat: 22.32, lng: 114.17, countryCode: "hk", timezone: "Asia/Hong_Kong" },
  },
  {
    key: "tokyo",
    raw: {
      place_id: "51synthTYO0001",
      name: "Tokyo",
      city: "Tokyo",
      state: "Tokyo",
      country: "Japan",
      country_code: "jp",
      lat: 35.6895,
      lon: 139.6917,
      result_type: "city",
      timezone: { name: "Asia/Tokyo", offset_STD: "+09:00" },
    },
    expected: { label: "Tokyo, Japan", lat: 35.69, lng: 139.69, countryCode: "jp", timezone: "Asia/Tokyo" },
  },
  {
    key: "seoul",
    raw: {
      place_id: "51synthSEL0001",
      name: "Seoul",
      city: "Seoul",
      country: "South Korea",
      country_code: "kr",
      lat: 37.5665,
      lon: 126.978,
      result_type: "city",
      timezone: { name: "Asia/Seoul", offset_STD: "+09:00" },
    },
    expected: { label: "Seoul, South Korea", lat: 37.57, lng: 126.98, countryCode: "kr", timezone: "Asia/Seoul" },
  },
  {
    key: "london",
    raw: {
      place_id: "51synthLON0001",
      name: "London",
      city: "London",
      state: "England",
      country: "United Kingdom",
      country_code: "gb",
      lat: 51.5072,
      lon: -0.1276,
      result_type: "city",
      timezone: { name: "Europe/London", offset_STD: "+00:00", offset_DST: "+01:00" },
    },
    expected: { label: "London, United Kingdom", lat: 51.51, lng: -0.13, countryCode: "gb", timezone: "Europe/London" },
  },
  {
    key: "auckland",
    raw: {
      place_id: "51synthAKL0001",
      name: "Auckland",
      city: "Auckland",
      state: "Auckland",
      country: "New Zealand",
      country_code: "nz",
      lat: -36.8485,
      lon: 174.7633,
      result_type: "city",
      timezone: { name: "Pacific/Auckland", offset_STD: "+12:00", offset_DST: "+13:00" },
    },
    expected: { label: "Auckland, New Zealand", lat: -36.85, lng: 174.76, countryCode: "nz", timezone: "Pacific/Auckland" },
  },
];

export const RAW_FIXTURE_RESULTS = FIXTURE_CITIES.map((c) => c.raw);
