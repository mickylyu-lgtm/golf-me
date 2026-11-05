// course-photos handler against a stubbed fetch and an in-memory store.
// Runs under Deno (`deno test --no-config supabase/functions/course-photos/`)
// and node (`node --test supabase/functions/course-photos/handler.test.ts`).
// No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAPS, QUOTA, handleRequest, resolveCoursePhotos, type CourseRow, type Deps, type ImageryRow } from "./handler.ts";

const DYKER: CourseRow = { id: "11111111-1111-4111-8111-111111111111", name: "Dyker Beach Golf Course", latitude: 40.6145, longitude: -74.0216 };
const OTHER: CourseRow = { id: "22222222-2222-4222-8222-222222222222", name: "Kissena Park Golf Course", latitude: 40.7472, longitude: -73.8075 };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeDeps(opts: {
  key?: string;
  places?: unknown[];
  details?: unknown[] | "404";
  photoUri?: string;
  wikiArticle?: { title: string; pageimage: string } | null;
  geotags?: string[];
  license?: string;
  caps?: Record<string, string>;
  imagery?: ImageryRow[];
  courses?: CourseRow[];
  /** Overpass answer (default: no outlines), or "fail" (every endpoint 504). */
  overpass?: unknown[] | "fail";
  /** Geoapify Place Details feature for the course. */
  geoapify?: unknown;
  geoKey?: string;
  /** Extra metadata per Commons file title (description/categories). */
  fileMeta?: Record<string, { description?: string; categories?: string; license?: string }>;
}) {
  const calls: Call[] = [];
  const saved: ImageryRow[] = [];
  const usage = new Map<string, number>();
  const rows = new Map((opts.imagery ?? []).map((r) => [r.course_id, { ...r }]));
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body as string | undefined });
    if (url.endsWith("/places:searchText")) return ok({ places: opts.places ?? [] });
    if (/\/v1\/places\/[^/]+$/.test(url)) {
      if (opts.details === "404") return new Response("{}", { status: 404 });
      return ok({ photos: opts.details ?? [] });
    }
    if (url.includes("/media?")) return ok({ name: "x", photoUri: opts.photoUri ?? "https://lh3.googleusercontent.com/p/abc=w240" });
    if (url.startsWith("https://en.wikipedia.org/")) {
      const a = opts.wikiArticle;
      return ok(a ? { query: { pages: { "1": { index: 1, title: a.title, pageimage: a.pageimage, original: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${a.pageimage}` } } } } } : {});
    }
    if (url.includes("list=geosearch")) return ok({ query: { geosearch: (opts.geotags ?? []).map((title) => ({ title })) } });
    if (url.includes("prop=imageinfo")) {
      const title = new URL(url).searchParams.get("titles") ?? "";
      const meta = opts.fileMeta?.[title] ?? {};
      return ok({
        query: {
          pages: {
            "5": {
              imageinfo: [
                {
                  thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title.replace(/^File:/, ""))}/960px-x.jpg`,
                  descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
                  extmetadata: {
                    Artist: { value: "<a href='x'>Jim</a>" },
                    LicenseShortName: { value: meta.license ?? opts.license ?? "CC BY-SA 4.0" },
                    ImageDescription: { value: meta.description ?? "" },
                    Categories: { value: meta.categories ?? "" },
                  },
                },
              ],
            },
          },
        },
      });
    }
    if (url.includes("/api/interpreter")) {
      if (opts.overpass === "fail") return new Response("busy", { status: 504 });
      return ok({ elements: opts.overpass ?? [] });
    }
    if (url.startsWith("https://api.geoapify.com/v2/place-details")) return ok({ features: opts.geoapify ? [opts.geoapify] : [] });
    return new Response("not stubbed", { status: 599 });
  }) as typeof fetch;

  const deps: Deps = {
    fetch: fetchStub,
    env: (name) => (name === "GOOGLE_PLACES_API_KEY" ? opts.key : name === "GEOAPIFY_API_KEY" ? opts.geoKey : opts.caps?.[name]),
    now: () => new Date("2026-11-05T12:00:00Z"),
    store: {
      async courses(ids) {
        return (opts.courses ?? [DYKER, OTHER]).filter((c) => ids.includes(c.id));
      },
      async imagery(ids) {
        return [...rows.values()].filter((r) => ids.includes(r.course_id));
      },
      async saveImagery(row) {
        saved.push({ ...row });
        rows.set(row.course_id, { ...(rows.get(row.course_id) ?? { course_id: row.course_id }), ...row });
      },
      async takeQuota(provider, cap, cost = 1) {
        const used = usage.get(provider) ?? 0;
        if (cap <= 0 || used + cost > cap) return false;
        usage.set(provider, used + cost);
        return true;
      },
    },
  };
  return { deps, calls, saved, usage, rows };
}

const GOOD_PLACE = {
  id: "ChIJdyker",
  displayName: { text: "Dyker Beach Golf Course" },
  location: { latitude: 40.6152, longitude: -74.0205 },
  types: ["golf_course", "point_of_interest"],
  googleMapsUri: "https://maps.google.com/?cid=1",
  photos: [
    { name: "places/ChIJdyker/photos/portrait", widthPx: 800, heightPx: 1200, authorAttributions: [{ displayName: "Pat", uri: "https://maps.google.com/contrib/1" }] },
    { name: "places/ChIJdyker/photos/wide", widthPx: 1600, heightPx: 900, authorAttributions: [{ displayName: "Sam Golfer", uri: "https://maps.google.com/contrib/2" }] },
  ],
};

test("Places hit: one Text Search, stores only the place id, returns a fresh photo URL with its author", async () => {
  const { deps, calls, saved, usage } = makeDeps({ key: "test-key", places: [GOOD_PLACE] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], size: "thumb" }, deps);
  const photo = res.photos[DYKER.id];
  assert.equal(photo?.source, "google");
  assert.ok(photo && photo.source === "google");
  assert.equal(photo.url, "https://lh3.googleusercontent.com/p/abc=w240");
  assert.deepEqual(photo.authors, [{ name: "Sam Golfer", uri: "https://maps.google.com/contrib/2" }]);
  assert.equal(calls.filter((c) => c.url.endsWith("/places:searchText")).length, 1);
  const search = calls.find((c) => c.url.endsWith("/places:searchText"))!;
  assert.equal(search.method, "POST");
  assert.equal(search.headers["X-Goog-Api-Key"], "test-key");
  assert.match(search.headers["X-Goog-FieldMask"], /places\.photos/);
  assert.equal(JSON.parse(search.body!).includedType, "golf_course");
  const media = calls.find((c) => c.url.includes("/media?"))!;
  assert.match(media.url, /places\/ChIJdyker\/photos\/wide\/media\?maxWidthPx=240&skipHttpRedirect=true/);
  assert.ok(!media.url.includes("test-key"), "key stays in a header, not the URL");
  // Stored: the place id + distance + checked time. No photo name/URL.
  const googleSaves = saved.filter((r) => "google_place_id" in r);
  assert.equal(googleSaves.length, 1);
  assert.equal(googleSaves[0].google_place_id, "ChIJdyker");
  assert.ok(!JSON.stringify(saved).includes("photos/"), "no photo name stored");
  assert.ok(!JSON.stringify(saved).includes("googleusercontent"), "no photo URL stored");
  assert.equal(usage.get(QUOTA.textSearch), 1);
  assert.equal(usage.get(QUOTA.photo), 1);
  assert.equal(calls.filter((c) => c.url.includes("wikimedia") || c.url.includes("wikipedia")).length, 0, "Wikimedia not asked");
});

test("a known place id skips Text Search and fetches photos with the free photos-only field mask", async () => {
  const { deps, calls } = makeDeps({
    key: "k",
    imagery: [{ course_id: DYKER.id, google_place_id: "ChIJdyker", google_checked_at: "2026-10-01T00:00:00Z" }],
    details: GOOD_PLACE.photos,
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], size: "hero" }, deps);
  assert.equal(res.photos[DYKER.id]?.source, "google");
  assert.equal(calls.filter((c) => c.url.endsWith("/places:searchText")).length, 0);
  const details = calls.find((c) => /\/v1\/places\/ChIJdyker$/.test(c.url))!;
  assert.equal(details.headers["X-Goog-FieldMask"], "photos");
  assert.match(calls.find((c) => c.url.includes("/media?"))!.url, /maxWidthPx=1200/);
});

test("a vanished place id (404) is forgotten so the course is looked up again", async () => {
  const { deps, rows } = makeDeps({
    key: "k",
    imagery: [{ course_id: DYKER.id, google_place_id: "ChIJgone", google_checked_at: "2026-10-01T00:00:00Z", wikimedia_checked_at: "2026-11-01T00:00:00Z" }],
    details: "404",
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.equal(res.photos[DYKER.id], null);
  assert.equal(rows.get(DYKER.id)?.google_place_id, null);
  assert.equal(rows.get(DYKER.id)?.google_checked_at, null);
});

test("Places miss (wrong course nearby) then Wikimedia: the Commons photo, license checked and stored", async () => {
  const wrong = { ...GOOD_PLACE, id: "ChIJother", displayName: { text: "Marine Park Golf Course" } };
  const { deps, rows } = makeDeps({
    key: "k",
    places: [wrong],
    wikiArticle: { title: "Dyker Beach Park", pageimage: "Dyker_Beach_Golf_Course.JPG" },
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  const photo = res.photos[DYKER.id];
  assert.ok(photo && photo.source === "wikimedia");
  assert.equal(photo.credit, "Jim, CC BY-SA 4.0 / Wikimedia Commons");
  assert.match(photo.url, /250px-/, "thumb size");
  const row = rows.get(DYKER.id)!;
  assert.equal(row.google_place_id, null, "no-match recorded");
  assert.equal(row.google_checked_at, "2026-11-05T12:00:00.000Z");
  assert.equal(row.wikimedia_license_class, "cc-by-sa");
});

test("a Commons file whose license can't be read is not used", async () => {
  const { deps } = makeDeps({ geotags: ["File:Dyker Beach golf 2014.jpg"], license: "Some custom terms" });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.equal(res.photos[DYKER.id], null);
});

test("both miss: an explicit null, both lookups remembered, nothing asked again on the next request", async () => {
  const { deps, calls } = makeDeps({ key: "k", places: [], wikiArticle: null, geotags: [] });
  const first = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.deepEqual(first.photos, { [DYKER.id]: null });
  const before = calls.length;
  const second = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.deepEqual(second.photos, { [DYKER.id]: null });
  assert.equal(calls.length, before, "cached 'none' makes no provider call");
});

test("cap reached: no Google call, falls back to Wikimedia; with no fallback the id is left out (retry later)", async () => {
  const caps = { COURSE_PHOTOS_DAILY_TEXT_SEARCH_CAP: "0" };
  const withWiki = makeDeps({ key: "k", places: [GOOD_PLACE], caps, wikiArticle: { title: "Dyker Beach Park", pageimage: "Dyker_Beach_Golf_Course.JPG" } });
  const a = await resolveCoursePhotos({ courseIds: [DYKER.id] }, withWiki.deps);
  assert.equal(a.photos[DYKER.id]?.source, "wikimedia");
  assert.equal(withWiki.calls.filter((c) => c.url.includes("googleapis")).length, 0);
  assert.equal(withWiki.rows.get(DYKER.id)?.google_checked_at, undefined, "not marked checked");

  const noWiki = makeDeps({ key: "k", places: [GOOD_PLACE], caps, wikiArticle: null, geotags: [] });
  const b = await resolveCoursePhotos({ courseIds: [DYKER.id] }, noWiki.deps);
  assert.ok(!(DYKER.id in b.photos), "unresolved: left out so the client may ask again");
});

test("the photo cap stops the billable media call", async () => {
  const { deps, calls } = makeDeps({ key: "k", places: [GOOD_PLACE], caps: { COURSE_PHOTOS_DAILY_PHOTO_CAP: "0" }, wikiArticle: null, geotags: [] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.equal(calls.filter((c) => c.url.includes("/media?")).length, 0);
  assert.ok(!(DYKER.id in res.photos));
});

test("daily caps are shared across requests", async () => {
  const { deps, usage } = makeDeps({ key: "k", places: [], caps: { COURSE_PHOTOS_DAILY_TEXT_SEARCH_CAP: "1" }, wikiArticle: null, geotags: [] });
  await resolveCoursePhotos({ courseIds: [DYKER.id, OTHER.id] }, deps);
  assert.equal(usage.get(QUOTA.textSearch), 1);
  assert.equal(DEFAULT_CAPS[QUOTA.textSearch], 150);
});

test("key missing: Google is skipped entirely, Wikimedia still answers", async () => {
  const { deps, calls } = makeDeps({ key: undefined, wikiArticle: { title: "Dyker Beach Park", pageimage: "Dyker_Beach_Golf_Course.JPG" } });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], size: "hero" }, deps);
  assert.equal(res.photos[DYKER.id]?.source, "wikimedia");
  assert.match(res.photos[DYKER.id]!.url, /960px-/);
  assert.equal(calls.filter((c) => c.url.includes("googleapis")).length, 0);
});

test("a Google outage falls back to Wikimedia and isn't recorded as 'no match'", async () => {
  const { deps, rows } = makeDeps({ key: "k", wikiArticle: { title: "Dyker Beach Park", pageimage: "Dyker_Beach_Golf_Course.JPG" } });
  const failing = deps.fetch;
  deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("googleapis") ? new Response("{}", { status: 503 }) : failing(input, init)) as typeof fetch;
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.equal(res.photos[DYKER.id]?.source, "wikimedia");
  assert.equal(rows.get(DYKER.id)?.google_checked_at, undefined);
});

test("input is cleaned: bad ids dropped, duplicates merged, at most 12, unknown ids answer null", async () => {
  const { deps } = makeDeps({ key: undefined, wikiArticle: null, geotags: [], courses: [] });
  const unknown = "33333333-3333-4333-8333-333333333333";
  const res = await resolveCoursePhotos({ courseIds: ["nope", unknown, unknown.toUpperCase(), 5] }, deps);
  assert.deepEqual(res.photos, { [unknown]: null });
});

const OUTLINE = { south: 40.6085, west: -74.0275, north: 40.6195, east: -74.0135 };
const RING = [[OUTLINE.west, OUTLINE.south], [OUTLINE.east, OUTLINE.south], [OUTLINE.east, OUTLINE.north], [OUTLINE.west, OUTLINE.north], [OUTLINE.west, OUTLINE.south]];
const OSM_DYKER = { type: "way", id: 1, tags: { leisure: "golf_course", name: "Dyker Beach Golf Course" }, bounds: { minlat: OUTLINE.south, minlon: OUTLINE.west, maxlat: OUTLINE.north, maxlon: OUTLINE.east } };

test("outline from Overpass: returned in `bounds`, stored, never asked again", async () => {
  const { deps, calls, rows } = makeDeps({ overpass: [OSM_DYKER], wikiArticle: null, geotags: [] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.deepEqual(res.bounds?.[DYKER.id], OUTLINE);
  assert.equal(rows.get(DYKER.id)?.outline_source, "osm");
  const op = calls.find((c) => c.url.includes("/api/interpreter"))!;
  assert.equal(op.method, "POST");
  assert.match(decodeURIComponent(op.body!), /leisure"="golf_course"/);
  const n = calls.filter((c) => c.url.includes("/api/interpreter")).length;
  const again = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.deepEqual(again.bounds?.[DYKER.id], OUTLINE);
  assert.equal(calls.filter((c) => c.url.includes("/api/interpreter")).length, n, "cached");
});

test("outline from Geoapify Place Details first when the course has a Geoapify id (no Overpass call)", async () => {
  const feature = { properties: { name: "Dyker Beach Golf Course", categories: ["sport.golf"] }, geometry: { type: "Polygon", coordinates: [RING] } };
  const { deps, calls, rows } = makeDeps({
    geoKey: "geo-key",
    geoapify: feature,
    courses: [{ ...DYKER, geoapify_place_id: "51abc" }],
    wikiArticle: null,
    geotags: [],
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.deepEqual(res.bounds?.[DYKER.id], OUTLINE);
  assert.equal(rows.get(DYKER.id)?.outline_source, "geoapify");
  assert.match(calls.find((c) => c.url.includes("place-details"))!.url, /id=51abc&features=details/);
  assert.equal(calls.filter((c) => c.url.includes("/api/interpreter")).length, 0);
});

test("Overpass down (every endpoint): no outline this time, not recorded, the other endpoint tried", async () => {
  const { deps, calls, rows } = makeDeps({ overpass: "fail", wikiArticle: null, geotags: [] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.ok(!(DYKER.id in (res.bounds ?? {})), "left out: the client keeps the point framing and may ask later");
  assert.equal(rows.get(DYKER.id)?.outline_checked_at, undefined);
  assert.equal(new Set(calls.filter((c) => c.url.includes("/api/interpreter")).map((c) => new URL(c.url).hostname)).size, 2);
  assert.equal(res.photos[DYKER.id], null, "the photo answer is unaffected");
});

test("outlineOnly: outlines without any photo lookup (nothing billable)", async () => {
  const { deps, calls } = makeDeps({ key: "k", places: [GOOD_PLACE], overpass: [OSM_DYKER] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], outlineOnly: true }, deps);
  assert.deepEqual(res.photos, {});
  assert.deepEqual(res.bounds?.[DYKER.id], OUTLINE);
  assert.equal(calls.filter((c) => c.url.includes("googleapis") || c.url.includes("wiki")).length, 0);
});

test("Commons: a clubhouse/sign shot is skipped for a photo that shows the course", async () => {
  const { deps } = makeDeps({
    geotags: ["File:Dyker Beach golf clubhouse.jpg", "File:Dyker Beach golf 2014.jpg", "File:Dyker Beach golf hole 7.jpg"],
    fileMeta: { "File:Dyker Beach golf 2014.jpg": { description: "Entrance sign on 86th Street" } },
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  const p = res.photos[DYKER.id];
  assert.ok(p && p.source === "wikimedia");
  assert.match(p.pageUrl, /hole%207/, "the hole photo, not the clubhouse or the sign");
});

test("Commons: when every candidate is a logo/sign/clubhouse, no photo (satellite instead)", async () => {
  const { deps } = makeDeps({
    geotags: ["File:Dyker Beach golf clubhouse.jpg", "File:Dyker Beach golf logo.jpg"],
  });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.equal(res.photos[DYKER.id], null);
});

test("HTTP: preflight, method, auth and body checks", async () => {
  const { deps } = makeDeps({});
  const yes = { ...deps, authenticate: async () => true };
  const no = { ...deps, authenticate: async () => false };
  assert.equal((await handleRequest(new Request("https://x/", { method: "OPTIONS" }), yes)).status, 204);
  assert.equal((await handleRequest(new Request("https://x/", { method: "GET" }), yes)).status, 405);
  assert.equal((await handleRequest(new Request("https://x/", { method: "POST", body: "{}" }), no)).status, 401);
  assert.equal((await handleRequest(new Request("https://x/", { method: "POST", body: "not json" }), yes)).status, 400);
  const ok = await handleRequest(new Request("https://x/", { method: "POST", body: JSON.stringify({ courseIds: [] }) }), yes);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { photos: {}, bounds: {} });
});
