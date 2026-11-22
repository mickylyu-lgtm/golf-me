import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BAYONNE_OFFICIAL_COURSE_ID as BAYONNE,
  BAYONNE_OFFICIAL_SCORECARD_URL,
  BAYONNE_SCORECARD_EXPIRES_AT,
  BAYONNE_SCORECARD_REVIEWED_ON,
  bayonneOfficialTeeRatings,
  courseTeeRatingsSource,
} from "../src/lib/bayonneOfficialTeeRatings.ts";

const reviewed = Date.parse("2026-11-22T12:00:00Z");
const expiry = Date.parse(BAYONNE_SCORECARD_EXPIRES_AT);
const access = { signedIn: true, isDemo: false, provider: false };
const other = "19badd87-fc23-4c7f-b6e5-51ed593ae526";

test("official course and slope numbers match the club's 18-hole scorecard", () => {
  const data = bayonneOfficialTeeRatings(BAYONNE, reviewed)!;
  assert.deepEqual(data.source, { url: BAYONNE_OFFICIAL_SCORECARD_URL, reviewedOn: BAYONNE_SCORECARD_REVIEWED_ON });
  assert.deepEqual(data.tees.map(({ name, group, holes, overall }) => [name, group, holes, overall.course, overall.slope]), [
    ["Black", "men", 18, 75, 151], ["Green", "men", 18, 73.7, 148],
    ["Blue", "men", 18, 72, 148], ["White", "men", 18, 70, 133],
    ["Red", "women", 18, 72.3, 127],
  ]);
  for (const tee of data.tees) {
    assert.equal(tee.overall.bogey, null);
    assert.deepEqual(tee.front, { course: null, slope: null, bogey: null });
    assert.deepEqual(tee.back, { course: null, slope: null, bogey: null });
  }
});

test("one default-on real authenticated course only; no names or unverified alternatives", () => {
  assert.equal(courseTeeRatingsSource(BAYONNE, access, reviewed), "bayonne");
  for (const id of [undefined, "Bayonne Golf Club", BAYONNE.toUpperCase(), other]) {
    assert.equal(bayonneOfficialTeeRatings(id, reviewed), null);
    assert.equal(courseTeeRatingsSource(id, access, reviewed), null);
  }
  assert.equal(courseTeeRatingsSource(BAYONNE, { ...access, signedIn: false }, reviewed), null);
  assert.equal(courseTeeRatingsSource(BAYONNE, { ...access, isDemo: true }, reviewed), null);
  assert.equal(courseTeeRatingsSource(BAYONNE, { ...access, bayonnePilot: "false" }, reviewed), null);
});

test("expired and pre-review data fail closed and never switch Bayonne to the provider", () => {
  const providerAlsoOn = { ...access, provider: true };
  assert.ok(bayonneOfficialTeeRatings(BAYONNE, expiry - 1));
  for (const time of [expiry, expiry + 1, NaN, Date.parse("2026-11-21T23:59:59Z")]) {
    assert.equal(bayonneOfficialTeeRatings(BAYONNE, time), null);
    assert.equal(courseTeeRatingsSource(BAYONNE, providerAlsoOn, time), null);
  }
  assert.equal(courseTeeRatingsSource(BAYONNE, { ...providerAlsoOn, bayonnePilot: "false" }, reviewed), null);
  assert.equal(courseTeeRatingsSource(other, providerAlsoOn, reviewed), "provider");
});

test("direct client ratings bypass vendor for the exact Bayonne ID", () => {
  const body = readFileSync(new URL("../src/lib/courseTeeRatings.ts", import.meta.url), "utf8").split("function loadCourseTeeRatings")[1];
  assert.ok(body.indexOf("if (isBayonneOfficialCourse(courseId)) return") >= 0);
  assert.ok(body.indexOf("if (isBayonneOfficialCourse(courseId)) return") < body.indexOf("supabase.functions.invoke"));
});
