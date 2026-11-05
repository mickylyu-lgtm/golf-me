// Run: npm run test:courses  (node --test, built-in type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_MATCH_MAX_M,
  NAMED_MATCH_MAX_M,
  compareCourseNames,
  distanceMeters,
  pickMatchingPlace,
  pickPlacePhoto,
  placeMatchesCourse,
  type PlaceCandidate,
} from "../supabase/functions/_shared/placesMatch.ts";
import {
  articleMatchesCourse,
  classifyCommonsLicense,
  commonsFileMatchesCourse,
  licenseAllowsDerivatives,
  licenseIsShareAlike,
} from "../supabase/functions/_shared/coursePhotoMatch.ts";

const DYKER = { name: "Dyker Beach Golf Course", lat: 40.6145, lng: -74.0216 };

// A point `m` metres due north of DYKER.
function north(m: number) {
  return { latitude: DYKER.lat + m / 111_195, longitude: DYKER.lng };
}

function place(name: string, m: number, extra: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return { id: `id-${name}-${m}`, displayName: { text: name }, location: north(m), types: ["golf_course"], ...extra };
}

test("distance is metres on the sphere", () => {
  assert.ok(Math.abs(distanceMeters(DYKER.lat, DYKER.lng, north(1000).latitude, DYKER.lng) - 1000) < 2);
  assert.equal(distanceMeters(1, 2, 1, 2), 0);
});

test("names: shared distinctive word, generic, or a different course", () => {
  assert.equal(compareCourseNames("Dyker Beach Golf Course", "Dyker Beach Golf Course"), "named");
  assert.equal(compareCourseNames("Dyker Beach Golf Course", "Dyker Beach Golf Club & Driving Range"), "named");
  assert.equal(compareCourseNames("Golf Course", "Dyker Beach Golf Course"), "generic");
  assert.equal(compareCourseNames("Dyker Beach Golf Course", "Marine Park Golf Course"), "none");
  // Same facility, different course.
  assert.equal(compareCourseNames("Bethpage Black Course", "Bethpage Red Course"), "none");
  assert.equal(compareCourseNames("Bethpage Black Course", "Bethpage State Park Black Course"), "named");
});

test("the right course near our point matches", () => {
  const r = placeMatchesCourse(DYKER, place("Dyker Beach Golf Course", 300));
  assert.equal(r.ok, true);
  assert.equal(r.distanceM, 300);
});

test("a named match may be up to 2.5 km away, not further", () => {
  assert.equal(placeMatchesCourse(DYKER, place("Dyker Beach Golf Course", NAMED_MATCH_MAX_M - 10)).ok, true);
  const far = placeMatchesCourse(DYKER, place("Dyker Beach Golf Course", NAMED_MATCH_MAX_M + 50));
  assert.deepEqual([far.ok, far.reason], [false, "too_far"]);
});

test("generic names only match when the points nearly agree", () => {
  const generic = { name: "Golf Course", lat: DYKER.lat, lng: DYKER.lng };
  assert.equal(placeMatchesCourse(generic, place("Some Golf Club", GENERIC_MATCH_MAX_M - 20)).ok, true);
  assert.equal(placeMatchesCourse(generic, place("Some Golf Club", GENERIC_MATCH_MAX_M + 100)).ok, false);
});

test("a different course next door, a non-golf place, or no location never matches", () => {
  assert.equal(placeMatchesCourse(DYKER, place("Marine Park Golf Course", 50)).reason, "name_mismatch");
  assert.equal(placeMatchesCourse(DYKER, place("Dyker Beach Golf Course", 50, { types: ["park"] })).reason, "not_golf");
  assert.equal(placeMatchesCourse(DYKER, place("Dyker Beach Golf Course", 0, { location: undefined })).reason, "no_location");
});

test("best place: a named match beats a generic one, then the nearest", () => {
  const generic = place("Golf Course", 40);
  const namedFar = place("Dyker Beach Golf Course", 900);
  const namedNear = place("Dyker Beach Golf Course", 200);
  assert.equal(pickMatchingPlace(DYKER, [generic, namedFar, namedNear])?.place.id, namedNear.id);
  assert.equal(pickMatchingPlace(DYKER, [place("Marine Park Golf Course", 10)]), null);
  assert.equal(pickMatchingPlace(DYKER, []), null);
});

test("photo choice: a large landscape photo first, then any landscape; never a square/portrait one", () => {
  const p = (n: string, w: number, h: number) => ({ name: `places/x/photos/${n}`, widthPx: w, heightPx: h });
  assert.equal(pickPlacePhoto([p("tall", 600, 900), p("wide", 1600, 900)])?.name, "places/x/photos/wide");
  assert.equal(pickPlacePhoto([p("smallwide", 800, 500), p("bigwide", 4000, 2250)])?.name, "places/x/photos/bigwide");
  assert.equal(pickPlacePhoto([p("smallwide", 800, 500), p("square", 900, 900)])?.name, "places/x/photos/smallwide");
  // Logos, menus and signs are mostly square or portrait: no photo, so the
  // view falls back to aerial imagery.
  assert.equal(pickPlacePhoto([p("tall", 600, 900), p("square", 800, 800)]), null);
  assert.equal(pickPlacePhoto([{ name: "places/x/photos/nosize" }]), null);
  assert.equal(pickPlacePhoto([]), null);
  assert.equal(pickPlacePhoto(undefined), null);
  assert.equal(pickPlacePhoto([{ name: "bogus" }]), null);
});

test("Wikimedia: a sibling course's photo at the same facility is refused", () => {
  // Found headless: Bethpage Blue and Red showed the Bethpage Black photo.
  assert.equal(articleMatchesCourse("Bethpage Red", "Bethpage Black Golf Course", "Bethpage_Black.jpg"), false);
  assert.equal(articleMatchesCourse("Bethpage Black", "Bethpage Black Golf Course", "Bethpage_Black.jpg"), true);
  // The facility's own article (no course named) still serves every course.
  assert.equal(articleMatchesCourse("Bethpage Red", "Bethpage State Park Golf Course", "Bethpage.jpg"), true);
  assert.equal(commonsFileMatchesCourse("Eisenhower Park Red", "File:Eisenhower Park White golf course 2012.jpg"), false);
  assert.equal(commonsFileMatchesCourse("Eisenhower Park White", "File:Eisenhower Park White golf course 2012.jpg"), true);
});

test("Commons licenses: free ones classified, anything unclear refused", () => {
  assert.equal(classifyCommonsLicense("CC0"), "cc0");
  assert.equal(classifyCommonsLicense("Public domain"), "pd");
  assert.equal(classifyCommonsLicense("PD-USGov"), "pd");
  assert.equal(classifyCommonsLicense("CC BY 2.0"), "cc-by");
  assert.equal(classifyCommonsLicense("CC BY-SA 4.0"), "cc-by-sa");
  assert.equal(classifyCommonsLicense("CC-BY-SA-3.0"), "cc-by-sa");
  assert.equal(classifyCommonsLicense("GFDL"), "gfdl");
  assert.equal(classifyCommonsLicense("CC BY-NC 2.0"), null);
  assert.equal(classifyCommonsLicense("CC BY-ND 4.0"), null);
  assert.equal(classifyCommonsLicense("Fair use"), null);
  assert.equal(classifyCommonsLicense(""), null);
  assert.equal(classifyCommonsLicense(undefined), null);
});

test("derivatives (AI clips) only from CC0, PD, CC BY, CC BY-SA; share-alike flagged", () => {
  for (const c of ["cc0", "pd", "cc-by", "cc-by-sa"] as const) assert.equal(licenseAllowsDerivatives(c), true);
  assert.equal(licenseAllowsDerivatives("gfdl"), false);
  assert.equal(licenseAllowsDerivatives(null), false);
  assert.equal(licenseIsShareAlike("cc-by-sa"), true);
  assert.equal(licenseIsShareAlike("cc-by"), false);
});
