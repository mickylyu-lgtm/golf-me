import test from "node:test";
import assert from "node:assert/strict";
import { createCourseTeeRatingsHandler, normalizeCourseTeeRatings, reviewedCourseReferences, verifyCourseTeeRatings } from "./handler.ts";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const V1 = "7k2m9qb4";
const V2 = "ab0cd8v7";
const vendor = (id: string | number = V1) => ({
  id, club_name: "Do not send upstream metadata", tees: {
    male: [
      { tee_name: " Blue ", number_of_holes: 18, course_rating: 72.4, slope_rating: 133, bogey_rating: 97.4,
        front_course_rating: 36.3, front_slope_rating: 130, front_bogey_rating: 48.2, back_course_rating: 36.1,
        back_slope_rating: 134, back_bogey_rating: 49.2, holes: [{ par: 4 }] },
      { tee_name: "Nine", number_of_holes: 9, course_rating: 34.4, slope_rating: 99, front_course_rating: 34.4,
        back_course_rating: 33.3, back_slope_rating: 155 },
      { tee_name: "Invalid", course_rating: 0, slope_rating: 156, bogey_rating: "90" },
    ],
    female: [{ tee_name: "Blue", number_of_holes: 18, course_rating: 78.1 }],
  },
});
// Synthetic scorecard values and reserved documentation domain, never real venues.
const sourceUrl = "https://example.com/scorecard.pdf";
const reviewedOn = "2026-11-21";
const official = {
  providerId: V1, sourceUrl, reviewedOn, tees: [
    { name: "Blue", group: "men", holes: 18, overall: { course: 72.4, slope: 133, bogey: 97.4 },
      front: { course: 36.3, slope: 130, bogey: 48.2 }, back: { course: 36.1, slope: 134, bogey: 49.2 } },
    { name: "Nine", group: "men", holes: 9, overall: { course: 34.4, slope: 99 }, front: { course: 34.4 } },
    { name: "Blue", group: "women", holes: 18, overall: { course: 78.1 } },
  ],
};
const reviews = (entry: unknown = official) => reviewedCourseReferences(JSON.stringify({ [C1]: entry }));
const request = (body: unknown = { courseId: C1 }, {
  auth = "Bearer fixture", origin = "https://golfme.app",
} = {}) => new Request("https://fixture.test/course-tee-ratings", {
  method: "POST", headers: { Authorization: auth, Origin: origin }, body: JSON.stringify(body),
});
function fixture(overrides: Partial<Parameters<typeof createCourseTeeRatingsHandler>[0]> = {}) {
  const calls = { auth: 0, account: 0, lookup: 0, quota: 0, vendor: 0 };
  let clock = Date.parse("2026-11-21T12:00:00Z");
  const handler = createCourseTeeRatingsHandler({
    enabled: () => true,
    reviewedCourses: reviews(),
    authorize: async () => { calls.auth++; return true; },
    consumeCallerBudget: async () => { calls.account++; return null; },
    lookupMappedId: async () => { calls.lookup++; return V1; },
    takeDetailQuota: async () => { calls.quota++; return true; },
    fetchDetail: async (id) => { calls.vendor++; assert.equal(id, V1); return Response.json(vendor()); },
    now: () => clock,
    ...overrides,
  });
  return { handler, calls, advance: (ms: number) => { clock += ms; } };
}

test("normalizes only named tee ratings with distinct groups and never invents nine-hole back ratings", () => {
  const output = verifyCourseTeeRatings(normalizeCourseTeeRatings(vendor(), V1), reviews().get(C1)!);
  assert.ok(output);
  const { tees } = output;
  assert.deepEqual(output.source, { url: sourceUrl, reviewedOn });
  assert.equal(tees.length, 3);
  assert.deepEqual(tees[0], { name: "Blue", group: "men", holes: 18,
    overall: { course: 72.4, slope: 133, bogey: 97.4 },
    front: { course: 36.3, slope: 130, bogey: 48.2 },
    back: { course: 36.1, slope: 134, bogey: 49.2 } });
  assert.deepEqual(tees[1].back, { course: null, slope: null, bogey: null });
  assert.equal(tees[1].front.course, 34.4);
  assert.equal(tees[2].group, "women");
  assert.equal(tees[2].overall.slope, null);
  assert.throws(() => normalizeCourseTeeRatings(vendor(V2), V1), /unexpected_course_detail/);
  assert.throws(() => normalizeCourseTeeRatings(vendor(42), V1), /unexpected_course_detail/);
  assert.throws(() => normalizeCourseTeeRatings({ course: vendor() }, V1), /unexpected_course_detail/);
});

test("reviewed scorecard config fails closed on malformed dates, link, identifiers, fields or duplicate identity", () => {
  assert.equal(reviewedCourseReferences(undefined).size, 0);
  assert.equal(reviewedCourseReferences("bad JSON").size, 0);
  assert.equal(reviewedCourseReferences(JSON.stringify({ [C1]: official, [C2]: official })).size, 0);
  assert.equal(reviews({ ...official, providerId: "7k2m9q/4" }).size, 0);
  assert.equal(reviews({ ...official, providerId: 42 }).size, 0);
  assert.equal(reviews({ ...official, providerId: "1234oil5" }).size, 0);
  for (const sourceUrl of ["http://example.com/card.pdf", "https://me:abc@example.com/card.pdf", "https://example.com/card?token=here",
    "https://127.0.0.1/card", "https://service.internal/card", "https://example.com:8443/card"]) {
    assert.equal(reviews({ ...official, sourceUrl }).size, 0);
  }
  assert.equal(reviews({ ...official, reviewedOn: "2026-02-30" }).size, 0);
  assert.equal(reviews({ ...official, tees: [official.tees[0], { ...official.tees[0], name: " blue " }] }).size, 0);
  assert.equal(reviews({ ...official, tees: [{ ...official.tees[0], overall: { course: 72.44 } }] }).size, 0);
  assert.equal(reviews({ ...official, tees: [{ ...official.tees[1], back: { slope: 100 } }] }).size, 0);
  assert.equal(reviews().get(C1)?.providerId, V1);
});

test("only exact same field, tee, group, hole count and segment is shown; no rounding or borrowing", () => {
  const upstream = { id: V1, tees: {
    male: [
      { tee_name: " bLuE ", number_of_holes: 18, course_rating: 72.44, slope_rating: 133, bogey_rating: 97.5,
        front_course_rating: 36.1, front_slope_rating: 130.1, back_bogey_rating: 48.2 },
      { tee_name: "Blue", number_of_holes: 9, course_rating: 72.4, slope_rating: 133 },
      { tee_name: "Different", number_of_holes: 18, course_rating: 72.4, slope_rating: 133 },
      { tee_name: "Nine", course_rating: 34.4, slope_rating: 99 },
    ],
    female: [{ tee_name: "Nine", number_of_holes: 9, course_rating: 34.4, slope_rating: 99 }],
  } };
  const output = verifyCourseTeeRatings(normalizeCourseTeeRatings(upstream, V1), reviews().get(C1)!);
  assert.deepEqual(output?.tees, [{ name: "Blue", group: "men", holes: 18,
    overall: { course: null, slope: 133, bogey: null },
    front: { course: null, slope: null, bogey: null }, back: { course: null, slope: null, bogey: null } }]);
});

test("duplicate named rows suppress that identity even if the duplicate has no ratings", () => {
  const payload = vendor();
  payload.tees.male.push({ tee_name: " blue ", number_of_holes: 18 } as typeof payload.tees.male[number]);
  const r = verifyCourseTeeRatings(normalizeCourseTeeRatings(payload, V1), reviews().get(C1)!);
  assert.ok(r);
  assert.equal(r.tees.some((tee) => tee.name === "Blue" && tee.group === "men"), false);
  assert.equal(r.tees.length, 2);
  const none = verifyCourseTeeRatings({ tees: [] }, reviews().get(C1)!);
  assert.equal(none, null);
});

test("unreviewed, future and expired source never reach the vendor, even from a warm cache", async () => {
  const future = fixture({ reviewedCourses: reviews({ ...official, reviewedOn: "2026-11-22" }) });
  assert.equal(await (await future.handler(request())).json(), null);
  assert.equal(future.calls.account + future.calls.lookup + future.calls.quota, 0);
  const f = fixture({ reviewedCourses: reviews({ ...official, reviewedOn: "2026-08-23" }) });
  assert.ok(await (await f.handler(request())).json());
  f.advance(12 * 60 * 60 * 1000); // Next UTC day expires the 90-day review.
  assert.equal(await (await f.handler(request())).json(), null);
  assert.equal(f.calls.vendor, 1);
  assert.equal(f.calls.account, 1);
});

test("rejects unexpected origins, unsupported methods and unsigned requests before any lookup", async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request(undefined, { origin: "https://other.test" }))).status, 403);
  assert.equal((await handler(request(undefined, { auth: "" }))).status, 401);
  const options = await handler(new Request("https://fixture.test", { method: "OPTIONS", headers: { Origin: "https://golfme.app" } }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), "https://golfme.app");
  assert.equal((await handler(new Request("https://fixture.test"))).status, 405);
  assert.deepEqual(calls, { auth: 0, account: 0, lookup: 0, quota: 0, vendor: 0 });
});

test("rejects malformed or oversized inputs and provider IDs supplied by the caller", async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request({ courseId: V1 }))).status, 400);
  assert.equal((await handler(request({ courseId: C1, providerId: V1 }))).status, 400);
  assert.equal((await handler(request({ courseId: "x".repeat(600) }))).status, 400);
  assert.equal(calls.lookup + calls.account, 0);
});

test("a canonical lookup alone without independent review, mismatch or feature off never spends quota", async () => {
  const standard = fixture();
  assert.equal(await (await standard.handler(request({ courseId: C2 }))).json(), null);
  assert.equal(standard.calls.lookup + standard.calls.account, 0);
  const mismatch = fixture({ lookupMappedId: async () => V2 });
  assert.equal(await (await mismatch.handler(request())).json(), null);
  assert.equal(mismatch.calls.vendor + mismatch.calls.quota, 0);
  const off = fixture({ enabled: () => false });
  assert.equal((await off.handler(request())).status, 503);
  assert.equal(off.calls.lookup + off.calls.account, 0);
});

test("auth and persistent quota failures fail closed without vendor calls", async () => {
  const auth = fixture({ authorize: async () => false });
  assert.equal((await auth.handler(request())).status, 401);
  assert.equal(auth.calls.account + auth.calls.lookup + auth.calls.vendor, 0);
  const account = fixture({ consumeCallerBudget: async () => new Response(null, { status: 429 }) });
  assert.equal((await account.handler(request())).status, 429);
  assert.equal(account.calls.lookup + account.calls.vendor, 0);
  const quota = fixture({ takeDetailQuota: async () => false });
  assert.equal((await quota.handler(request())).status, 503);
  assert.equal(quota.calls.vendor, 0);
});

test("serves private normalized payload, coalesces warm misses and revalidates mapping each time", async () => {
  const { handler, calls, advance } = fixture();
  const [first, second] = await Promise.all([handler(request()), handler(request())]);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await first.json(), await second.json());
  assert.deepEqual(calls, { auth: 2, account: 2, lookup: 2, quota: 1, vendor: 1 });
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls.vendor, 1);
  advance(24 * 60 * 60 * 1000);
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(calls, { auth: 4, account: 4, lookup: 4, quota: 2, vendor: 2 });
});

test("only stable empty data are briefly cached; provider mismatch, 429, bad or oversized payload are retryable", async () => {
  for (const fetchDetail of [
    async () => Response.json(vendor(V2)),
    async () => new Response("secret upstream error", { status: 429 }),
    async () => new Response("x".repeat(600 * 1024)),
  ]) {
    const { handler, calls } = fixture({ fetchDetail });
    for (let i = 0; i < 2; i++) {
      const response = await handler(request());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "ratings_unavailable" });
    }
    assert.equal(calls.quota, 2);
  }
  const { handler, calls, advance } = fixture({ fetchDetail: async () => new Response(null, { status: 404 }) });
  assert.equal(await (await handler(request())).json(), null);
  assert.equal(await (await handler(request())).json(), null);
  assert.equal(calls.quota, 1);
  advance(30 * 60 * 1000);
  assert.equal(await (await handler(request())).json(), null);
  assert.equal(calls.quota, 2);
});
