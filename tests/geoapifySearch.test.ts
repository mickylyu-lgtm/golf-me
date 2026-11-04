// Run: npm run test:courses  (node --test, built-in type stripping)
// Synthetic Geoapify-shaped fixtures only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanQuery,
  geocodeAmenityUrl,
  geocodeResultToCourse,
  mergeCourseCandidates,
  placeAutocompleteUrl,
  placesByNameUrl,
  toPlaceResults,
} from "../supabase/functions/_shared/geoapifySearch.ts";
import type { CourseCandidate, GeocodeResult } from "../supabase/functions/_shared/geoapifySearch.ts";

const KEY = "test-key";
const params = (url: string) => new URL(url).searchParams;

test("course name search really sends the name (Places has no text= parameter)", () => {
  const places = params(placesByNameUrl(KEY, "Rock Spring", 40.71, -74.01));
  assert.equal(places.get("name"), "Rock Spring");
  assert.equal(places.get("text"), null);
  assert.equal(places.get("categories"), "sport.golf_course");
  assert.equal(places.get("bias"), "proximity:-74.01,40.71");
  assert.equal(places.get("filter"), null, "no radius: a course outside the nearest 20 is still found");

  const geo = params(geocodeAmenityUrl(KEY, "Rock Spring", 40.71, -74.01));
  assert.equal(geo.get("text"), "Rock Spring");
  assert.equal(geo.get("type"), "amenity");
  assert.equal(geo.get("format"), "json");

  assert.equal(params(placesByNameUrl(KEY, "Bethpage")).get("bias"), null, "no location: no bias");
  assert.equal(params(placeAutocompleteUrl(KEY, "Astoria", Number.NaN, 1)).get("bias"), null);
});

test("cleanQuery trims, collapses and caps", () => {
  assert.equal(cleanQuery("  Rock   Spring  "), "Rock Spring");
  assert.equal(cleanQuery("x".repeat(200)).length, 80);
  assert.equal(cleanQuery(42), "");
});

const rockSpring: GeocodeResult = {
  place_id: "p-rock",
  name: "Rock Spring Golf Club",
  city: "West Orange",
  state: "New Jersey",
  country: "United States",
  lat: 40.7917,
  lon: -74.2724,
  result_type: "amenity",
  category: "sport.golf_course",
};

test("geocoder hits: golf courses kept, everything else dropped", () => {
  assert.equal(geocodeResultToCourse(rockSpring)?.place_id, "p-rock");
  assert.ok(geocodeResultToCourse({ ...rockSpring, category: undefined }), "no category, golf-like name");
  assert.equal(geocodeResultToCourse({ ...rockSpring, name: "Rock Spring Diner", category: "catering.restaurant" }), null);
  assert.equal(geocodeResultToCourse({ ...rockSpring, name: "Rock Spring Road", category: undefined }), null);
  assert.equal(geocodeResultToCourse({ ...rockSpring, name: "Putt Putt Mini Golf", category: "entertainment.miniature_golf" }), null);
  assert.equal(geocodeResultToCourse({ ...rockSpring, place_id: undefined }), null);
  assert.equal(geocodeResultToCourse({ ...rockSpring, lat: undefined }), null);
});

test("merge: Places first, one entry per place and per name at the same spot", () => {
  const a: CourseCandidate = { place_id: "p1", name: "Rock Spring Golf Club", lat: 40.7917, lon: -74.2724, categories: ["sport.golf_course"] };
  const sameIdOther: CourseCandidate = { ...a, name: "Rock Spring GC" };
  const sameSpotOtherId: CourseCandidate = { ...a, place_id: "p2", lat: 40.7921 };
  const elsewhere: CourseCandidate = { place_id: "p3", name: "Rock Spring Golf Club", lat: 39.1, lon: -77.2, categories: [] };
  const merged = mergeCourseCandidates([a], [sameIdOther, sameSpotOtherId, elsewhere]);
  assert.deepEqual(merged.map((c) => c.place_id), ["p1", "p3"]);
});

test("place search: areas only, labelled, rounded to ~1 km", () => {
  const results: GeocodeResult[] = [
    { result_type: "suburb", suburb: "Astoria", city: "New York", state_code: "NY", country_code: "us", lat: 40.772342, lon: -73.930124 },
    { result_type: "city", city: "Hoboken", state_code: "NJ", country_code: "us", lat: 40.74399, lon: -74.03236 },
    { result_type: "postcode", postcode: "11103", city: "Queens", state_code: "NY", country_code: "us", lat: 40.7627, lon: -73.9145 },
    { result_type: "street", name: "Astoria Blvd", lat: 40.77, lon: -73.9 },
    { result_type: "amenity", name: "Astoria Park", lat: 40.78, lon: -73.92 },
    { result_type: "city", city: "London", state: "England", country_code: "gb", lat: 51.5072, lon: -0.1276 },
    { result_type: "suburb", suburb: "Astoria", city: "New York", state_code: "NY", country_code: "us", lat: 40.77, lon: -73.93 },
    { result_type: "city", city: "Nowhere", lat: Number.NaN, lon: 1 },
  ];
  assert.deepEqual(toPlaceResults(results), [
    { label: "Astoria, New York, NY", lat: 40.77, lng: -73.93 },
    { label: "Hoboken, NJ", lat: 40.74, lng: -74.03 },
    { label: "11103 Queens, NY", lat: 40.76, lng: -73.91 },
    { label: "London, England", lat: 51.51, lng: -0.13 },
  ]);
  assert.equal(toPlaceResults(results, 2).length, 2);
});
