// course-photos handler against a stubbed fetch and an in-memory store.
// Runs under Deno (`deno test --no-config supabase/functions/course-photos/`)
// and node (`node --test supabase/functions/course-photos/handler.test.ts`).
// No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOverpassAnswer } from "../_shared/courseLayout.ts";
import { DEFAULT_CAPS, OVERPASS_ENDPOINTS, QUOTA, handleRequest, resolveCoursePhotos, type CourseRow, type Deps, type ImageryRow } from "./handler.ts";

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
  /** NAIP export answers: "ok" (a JPEG), "fail" (500), "html" (200 text),
   * "slow-first" (the un-nudged URL takes 300 ms, the hedge 5 ms). */
  naip?: "ok" | "fail" | "html" | "slow-first";
  /** The layout query's Overpass answer (JSON body), or "fail" (504). */
  layoutAnswer?: unknown | "fail";
  /** Per layout query, in order (the last one repeats); wins over
   * layoutAnswer. */
  layoutAnswers?: (unknown | "fail")[];
  /** Each layout query takes this long (ms). */
  layoutDelayMs?: number;
  /** EdgeRuntime.waitUntil stand-in: collects the background promises. */
  background?: boolean;
}) {
  const calls: Call[] = [];
  const saved: ImageryRow[] = [];
  const usage = new Map<string, number>();
  const uploads: { path: string; size: number }[] = [];
  let naipFirstUrl: string | undefined;
  let layoutAsked = 0;
  const sleeps: number[] = [];
  const background: Promise<unknown>[] = [];
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
    if (url.startsWith("https://imagery.nationalmap.gov/")) {
      if (opts.naip === "fail" || !opts.naip) return new Response("boom", { status: 500 });
      if (opts.naip === "html") return new Response("<html>error</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      const jpeg = new Uint8Array(40_000);
      jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
      // The first export URL seen is the primary; a different one is the hedge.
      naipFirstUrl ??= url;
      const nudged = url !== naipFirstUrl;
      const delay = opts.naip === "slow-first" ? (nudged ? 5 : 300) : 0;
      await new Promise((r) => setTimeout(r, delay));
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(jpeg, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }
    if (url.includes("/api/interpreter") && String(init?.body ?? "").includes(encodeURIComponent('"golf"~'))) {
      const seq = opts.layoutAnswers;
      const answer = seq ? seq[Math.min(layoutAsked, seq.length - 1)] : opts.layoutAnswer;
      layoutAsked++;
      if (opts.layoutDelayMs) await new Promise((r) => setTimeout(r, opts.layoutDelayMs));
      if (answer === "fail") return new Response("busy", { status: 504 });
      return ok(answer ?? { elements: [] });
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
    // The retry pause is recorded, not waited; the first server is the
    // first in the list.
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    ...(opts.background ? { background: (p: Promise<unknown>) => void background.push(p) } : {}),
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
      async uploadPicture(path, bytes) {
        uploads.push({ path, size: bytes.length });
      },
      publicPictureUrl(path) {
        return `https://proj.supabase.co/storage/v1/object/public/course-imagery/${path}`;
      },
    },
  };
  return { deps, calls, saved, usage, rows, uploads, sleeps, background };
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

test("Overpass down: no outline this time, not recorded, FOSSGIS's two servers only (never maps.mail.ru)", async () => {
  assert.deepEqual(OVERPASS_ENDPOINTS, ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter"]);
  const { deps, calls, rows } = makeDeps({ overpass: "fail", wikiArticle: null, geotags: [] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id] }, deps);
  assert.ok(!(DYKER.id in (res.bounds ?? {})), "left out: the client keeps the point framing and may ask later");
  assert.equal(rows.get(DYKER.id)?.outline_checked_at, undefined);
  const hosts = new Set(calls.filter((c) => c.url.includes("/api/interpreter")).map((c) => new URL(c.url).hostname));
  assert.deepEqual([...hosts], ["overpass-api.de", "z.overpass-api.de"]);
  assert.equal(calls.some((c) => c.url.includes("mail.ru")), false);
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

// ---- Course page detail (20261107190000): NAIP picture + OSM layout ----

// Dyker Beach with a stored outline, so no outline lookup runs.
const DYKER_OUTLINE: ImageryRow = {
  course_id: DYKER.id,
  outline_south: 40.61,
  outline_west: -74.026,
  outline_north: 40.619,
  outline_east: -74.016,
  outline_source: "osm",
  outline_checked_at: "2026-11-01T00:00:00Z",
};
const LONDON: CourseRow = { id: "33333333-3333-4333-8333-333333333333", name: "Richmond Park Golf", latitude: 51.44, longitude: -0.27 };
const LAYOUT_OK = {
  elements: [
    { type: "way", tags: { golf: "hole", ref: "1", par: "4" }, geometry: [{ lat: 40.612, lon: -74.02 }, { lat: 40.613, lon: -74.021 }] },
    { type: "way", tags: { golf: "green" }, geometry: [{ lat: 40.613, lon: -74.021 }, { lat: 40.613, lon: -74.0205 }, { lat: 40.6132, lon: -74.0205 }, { lat: 40.613, lon: -74.021 }] },
  ],
};
const exportCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith("https://imagery.nationalmap.gov/"));
const layoutCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/api/interpreter") && String(c.body ?? "").includes(encodeURIComponent('"golf"~')));

test("picture: rendered once, stored in the public bucket, then served from Storage without asking USGS again", async () => {
  const { deps, calls, uploads, rows } = makeDeps({ imagery: [DYKER_OUTLINE], naip: "ok" });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], picture: true }, deps);
  const pic = res.pictures?.[DYKER.id];
  assert.ok(pic, "a picture");
  assert.match(pic.url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/course-imagery\/naip\/v1\/11111111-1111-4111-8111-111111111111\/\d+x\d+-[0-9a-f]{8}\.jpg$/);
  assert.equal(pic.bbox.length, 4);
  assert.equal(uploads.length, 1);
  assert.equal(exportCalls(calls).length, 1);
  assert.equal(rows.get(DYKER.id)?.naip_path, pic.url.split("/course-imagery/")[1]);
  assert.equal(res.photos[DYKER.id], undefined, "no photo lookup on a detail request");
  // Next viewer: straight from the stored row.
  const again = await resolveCoursePhotos({ courseIds: [DYKER.id], picture: true }, deps);
  assert.deepEqual(again.pictures?.[DYKER.id], pic);
  assert.equal(exportCalls(calls).length, 1);
  assert.equal(uploads.length, 1);
});

test("picture: a failed or non-JPEG render is not stored (null: the tiles stay), retried next time", async () => {
  for (const naip of ["fail", "html"] as const) {
    const { deps, uploads, saved } = makeDeps({ imagery: [DYKER_OUTLINE], naip, caps: { COURSE_PHOTOS_NAIP_HEDGE_MS: "5" } });
    const res = await resolveCoursePhotos({ courseIds: [DYKER.id], picture: true }, deps);
    assert.equal(res.pictures?.[DYKER.id], null, naip);
    assert.equal(uploads.length, 0);
    assert.ok(!saved.some((r) => r.naip_path), "nothing recorded");
  }
});

test("picture: a slow first render is hedged by a second request for the same picture; the fast one wins", async () => {
  const { deps, calls, usage, uploads } = makeDeps({ imagery: [DYKER_OUTLINE], naip: "slow-first", caps: { COURSE_PHOTOS_NAIP_HEDGE_MS: "20" } });
  const t = Date.now();
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], picture: true }, deps);
  assert.ok(res.pictures?.[DYKER.id]);
  assert.ok(Date.now() - t < 250, "did not wait for the slow render");
  const ex = exportCalls(calls);
  assert.equal(ex.length, 2);
  assert.notEqual(ex[0].url, ex[1].url, "the hedge is a different URL (nudged box)");
  assert.equal(usage.get(QUOTA.usgsExport), 2, "both renders counted against the cap");
  assert.equal(uploads.length, 1);
});

test("picture: only US courses, only with an outline, and within the daily cap", async () => {
  const london = makeDeps({ courses: [LONDON], imagery: [{ ...DYKER_OUTLINE, course_id: LONDON.id, outline_south: 51.43, outline_north: 51.45, outline_west: -0.29, outline_east: -0.25 }], naip: "ok" });
  const r1 = await resolveCoursePhotos({ courseIds: [LONDON.id], picture: true }, london.deps);
  assert.equal(r1.pictures?.[LONDON.id], null);
  assert.equal(exportCalls(london.calls).length, 0);
  const capped = makeDeps({ imagery: [DYKER_OUTLINE], naip: "ok", caps: { COURSE_PHOTOS_DAILY_USGS_EXPORT_CAP: "0" } });
  const r2 = await resolveCoursePhotos({ courseIds: [DYKER.id], picture: true }, capped.deps);
  assert.equal(r2.pictures?.[DYKER.id], null);
  assert.equal(exportCalls(capped.calls).length, 0);
});

test("layout: one Overpass query to a FOSSGIS server (identified), stored, never asked again", async () => {
  const { deps, calls, rows } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswer: LAYOUT_OK });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  const a = res.layouts?.[DYKER.id];
  assert.equal(a?.status, "ok");
  const lc = layoutCalls(calls);
  assert.equal(lc.length, 1);
  assert.equal(new URL(lc[0].url).hostname, "overpass-api.de");
  assert.match(lc[0].headers["User-Agent"] ?? "", /GolfMe/);
  assert.equal(rows.get(DYKER.id)?.layout_status, "ok");
  await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(layoutCalls(calls).length, 1);
  assert.equal(calls.some((c) => c.url.includes("mail.ru") && String(c.body ?? "").includes(encodeURIComponent('"golf"~'))), false);
});

test("layout: an HTTP 200 with an Overpass error remark, HTML or a 504 is transient: no answer, nothing stored", async () => {
  for (const layoutAnswer of [{ elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds." }, "fail", { nope: true }]) {
    const { deps, saved } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswer });
    const res = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
    assert.ok(res.layouts, "the server knows layouts");
    assert.equal(res.layouts![DYKER.id], undefined, JSON.stringify(layoutAnswer));
    assert.ok(!saved.some((r) => r.layout_status), "not recorded");
  }
});

test("layout: a valid empty answer is 'unmapped', kept 7 days, then asked again", async () => {
  const { deps, calls, rows } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswer: { elements: [] } });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.deepEqual(res.layouts?.[DYKER.id], { status: "unmapped" });
  assert.equal(rows.get(DYKER.id)?.layout_status, "unmapped");
  await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(layoutCalls(calls).length, 1, "within 7 days: from the row");
  const later = makeDeps({ imagery: [{ ...DYKER_OUTLINE, layout_status: "unmapped", layout_checked_at: "2026-10-28T00:00:00Z" }], layoutAnswer: LAYOUT_OK });
  const r2 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, later.deps);
  assert.equal(r2.layouts?.[DYKER.id]?.status, "ok", "8 days later the course is mapped now");
});

test("detail requests: one course only, a small layout cap, and no photo lookups", async () => {
  const { deps, calls } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswer: LAYOUT_OK, key: "k", caps: { COURSE_PHOTOS_DAILY_OVERPASS_LAYOUT_CAP: "0" } });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id, OTHER.id], layout: true }, deps);
  assert.deepEqual(Object.keys(res.layouts ?? {}), [], "cap 0: nothing asked, nothing answered");
  assert.equal(layoutCalls(calls).length, 0);
  assert.equal(calls.some((c) => c.url.includes("places")), false);
  assert.equal(DEFAULT_CAPS[QUOTA.overpassLayout], 40);
});

// ---- Layout reliability (2026-11-07, Silver Lake "Couldn't load the course layout") ----

const ERROR_REMARK = { elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' };
const layoutHosts = (calls: Call[]) => layoutCalls(calls).map((c) => new URL(c.url).hostname);

test("layout: a failed ask (504, error remark) is retried once on FOSSGIS's other server after a jittered pause; each ask takes a cap unit", async () => {
  for (const first of ["fail", ERROR_REMARK] as const) {
    const { deps, calls, rows, sleeps, usage } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswers: [first, LAYOUT_OK] });
    const res = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
    assert.equal(res.layouts?.[DYKER.id]?.status, "ok");
    assert.deepEqual(layoutHosts(calls), ["overpass-api.de", "z.overpass-api.de"]);
    for (const c of layoutCalls(calls)) assert.match(c.headers["User-Agent"] ?? "", /^GolfMe\//);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 500 && sleeps[0] <= 2000, `jitter ${sleeps[0]}`);
    assert.equal(usage.get(QUOTA.overpassLayout), 2);
    assert.equal(rows.get(DYKER.id)?.layout_status, "ok");
  }
});

test("layout: at most two asks; both failing stores nothing and clears the in-progress marker", async () => {
  const { deps, calls, rows } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswers: ["fail"] });
  const res = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(res.layouts?.[DYKER.id], undefined);
  assert.equal(res.layoutsPending, undefined);
  assert.equal(layoutCalls(calls).length, 2);
  assert.equal(rows.get(DYKER.id)?.layout_status, undefined);
  assert.equal(rows.get(DYKER.id)?.layout_checked_at, null, "marker cleared: the next view may ask again");
});

test("layout: a valid 'unmapped' is final (no retry); the retry respects the daily cap", async () => {
  const a = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswers: [{ elements: [] }, LAYOUT_OK] });
  assert.deepEqual((await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, a.deps)).layouts?.[DYKER.id], { status: "unmapped" });
  assert.equal(layoutCalls(a.calls).length, 1);
  const b = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswers: ["fail", LAYOUT_OK], caps: { COURSE_PHOTOS_DAILY_OVERPASS_LAYOUT_CAP: "1" } });
  assert.equal((await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, b.deps)).layouts?.[DYKER.id], undefined);
  assert.equal(layoutCalls(b.calls).length, 1, "cap 1: no retry");
});

test("layout: a slow lookup answers 'pending', finishes in the background and is stored; the next ask gets it", async () => {
  const { deps, calls, rows, background } = makeDeps({
    imagery: [DYKER_OUTLINE],
    layoutAnswer: LAYOUT_OK,
    layoutDelayMs: 60,
    background: true,
    caps: { COURSE_PHOTOS_LAYOUT_WAIT_MS: "5" },
  });
  const r1 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.deepEqual(r1.layoutsPending, [DYKER.id]);
  assert.equal(r1.layouts?.[DYKER.id], undefined);
  assert.equal(background.length, 1, "kept alive past the response");
  assert.ok(rows.get(DYKER.id)?.layout_checked_at && rows.get(DYKER.id)?.layout_status == null, "in-progress marker");
  // A second ask while it runs joins it (no second Overpass query).
  const r2 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.deepEqual(r2.layoutsPending, [DYKER.id]);
  await Promise.all(background);
  assert.equal(layoutCalls(calls).length, 1);
  assert.equal(rows.get(DYKER.id)?.layout_status, "ok");
  const r3 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(r3.layouts?.[DYKER.id]?.status, "ok");
  assert.equal(r3.layoutsPending, undefined);
  assert.equal(layoutCalls(calls).length, 1);
});

test("layout: a fast answer comes back inline even with a background runner", async () => {
  const { deps } = makeDeps({ imagery: [DYKER_OUTLINE], layoutAnswer: LAYOUT_OK, background: true });
  const r = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(r.layouts?.[DYKER.id]?.status, "ok");
  assert.equal(r.layoutsPending, undefined);
});

test("layout: another isolate's fresh marker means 'pending' with no query; a stale one (job died) is asked again", async () => {
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  const fresh = makeDeps({ imagery: [{ ...DYKER_OUTLINE, layout_checked_at: new Date(now - 30_000).toISOString() }], layoutAnswer: LAYOUT_OK, background: true });
  const r1 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, fresh.deps);
  assert.deepEqual(r1.layoutsPending, [DYKER.id]);
  assert.equal(layoutCalls(fresh.calls).length, 0);
  const stale = makeDeps({ imagery: [{ ...DYKER_OUTLINE, layout_checked_at: new Date(now - 10 * 60_000).toISOString() }], layoutAnswer: LAYOUT_OK, background: true });
  const r2 = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, stale.deps);
  assert.equal(r2.layouts?.[DYKER.id]?.status, "ok");
  assert.equal(layoutCalls(stale.calls).length, 1);
});

test("layout: a stale stored layout being re-checked keeps its row (no marker) and is served if Overpass fails", async () => {
  const parsed = classifyOverpassAnswer(LAYOUT_OK, DYKER.name);
  assert.equal(parsed.kind, "ok");
  const old = { ...DYKER_OUTLINE, layout_status: "ok" as const, layout_checked_at: "2026-07-01T00:00:00Z", layout: (parsed as { layout: unknown }).layout };
  const { deps, saved } = makeDeps({ imagery: [old], layoutAnswers: ["fail"] });
  const r = await resolveCoursePhotos({ courseIds: [DYKER.id], layout: true }, deps);
  assert.equal(r.layouts?.[DYKER.id]?.status, "ok");
  assert.equal(saved.length, 0, "nothing written");
});
