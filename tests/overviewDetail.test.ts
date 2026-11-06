// Run: npm run test:courses  (node --test, built-in type stripping)
// The course overview's detail (2026-11-07): validating Overpass answers,
// the endpoint race, layout cache TTLs and retries, the course-photos path
// (picture + layout), the one-download picture, and the status line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOverpassAnswer, isLayoutAnswer, settleLayoutAttempts, type OverpassVerdict } from "../supabase/functions/_shared/courseLayout.ts";
import { layoutUiStatus } from "../src/lib/overviewStatus.ts";

const NAME = "Forest Park Golf Course";
const B = { south: 40.6969, west: -73.8688, north: 40.7027, east: -73.859 };
const ID = "44444444-4444-4444-8444-444444444444";
const VALID = {
  elements: [
    { type: "way", tags: { golf: "hole", ref: "1", par: "4" }, geometry: [{ lat: 40.698, lon: -73.865 }, { lat: 40.699, lon: -73.864 }] },
    { type: "way", tags: { golf: "green" }, geometry: [{ lat: 40.699, lon: -73.864 }, { lat: 40.699, lon: -73.8635 }, { lat: 40.6992, lon: -73.8635 }, { lat: 40.699, lon: -73.864 }] },
  ],
};
const ERROR_REMARK = { version: 0.6, elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' };
const later = <T>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

// ---- classifying an answer ----

test("an Overpass answer is only 'unmapped' when it is complete and valid", () => {
  assert.equal(classifyOverpassAnswer(VALID, NAME).kind, "ok");
  assert.equal(classifyOverpassAnswer({ version: 0.6, elements: [] }, NAME).kind, "unmapped");
  assert.equal(classifyOverpassAnswer({ elements: [{ type: "way", tags: { golf: "bunker" }, geometry: [] }] }, NAME).kind, "unmapped");
  for (const bad of [ERROR_REMARK, { elements: [], remark: "runtime error: out of memory" }, { remark: "Dispatcher_Client::request_read_and_idx::rate_limited" }, {}, [], null, "<html>busy</html>", { elements: "x" }]) {
    assert.equal(classifyOverpassAnswer(bad, NAME).kind, "invalid", JSON.stringify(bad));
  }
  // A harmless remark (no error) doesn't spoil a real answer.
  assert.equal(classifyOverpassAnswer({ ...VALID, remark: "note: area query" }, NAME).kind, "ok");
});

// ---- the race ----

const ok = classifyOverpassAnswer(VALID, NAME) as OverpassVerdict;
const unmapped: OverpassVerdict = { kind: "unmapped" };
const invalid: OverpassVerdict = { kind: "invalid", reason: "remark" };

test("race: a fast broken or empty answer never beats a slower real one (the 116c441 bug)", async () => {
  let wins = 0;
  const a = await settleLayoutAttempts([later(invalid, 5), later(ok, 40)], () => wins++);
  assert.equal(a?.status, "ok");
  const b = await settleLayoutAttempts([later(unmapped, 5), later(ok, 40)]);
  assert.equal(b?.status, "ok", "an empty answer waits for the others");
  assert.equal(wins, 1, "the others are cancelled once, by the winner");
});

test("race: unmapped only when nothing better came; all failed -> null (transient)", async () => {
  assert.deepEqual(await settleLayoutAttempts([later(unmapped, 5), later(invalid, 10)]), { status: "unmapped" });
  assert.equal(await settleLayoutAttempts([later(invalid, 5), Promise.reject(new Error("net"))]), null);
  assert.equal(await settleLayoutAttempts([]), null);
  // A first good answer wins at once (doesn't wait for a slow straggler).
  const t = Date.now();
  const r = await settleLayoutAttempts([later(ok, 5), later(invalid, 300)]);
  assert.equal(r?.status, "ok");
  assert.ok(Date.now() - t < 200);
});

test("only well-formed answers are trusted from the server or the cache", () => {
  assert.equal(isLayoutAnswer({ status: "unmapped" }), true);
  assert.equal(isLayoutAnswer({ status: "ok", layout: { v: 1, areas: [], holes: [] } }), false, "an empty 'ok' is not a layout");
  assert.equal(isLayoutAnswer({ status: "ok", layout: null }), false);
  assert.equal(isLayoutAnswer({ status: "nope" }), false);
  assert.equal(isLayoutAnswer(null), false);
});

// ---- the browser client ----

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
}

type FetchPlan = (url: string, init?: RequestInit) => Promise<unknown>;
let session = 0;
async function client(plan: FetchPlan, storage = memoryStorage()) {
  const calls: string[] = [];
  Object.assign(globalThis, {
    localStorage: storage,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push(url);
      return plan(url, init);
    },
  });
  // A fresh module = a new app session (its in-memory maps are empty).
  const mod = await import(`../src/lib/courseDetailImagery.ts?s=${++session}`);
  return { mod, calls, storage };
}
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const hang = (_u: string, init?: RequestInit) =>
  new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

test("demo/direct: overpass-api.de only (never maps.mail.ru); a layout is cached on the device for 30 days", async () => {
  const { mod, calls, storage } = await client(() => json(VALID));
  const r = await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false });
  assert.equal(r.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).hostname, "overpass-api.de");
  assert.deepEqual(mod.LAYOUT_OVERPASS_ENDPOINTS, ["https://overpass-api.de/api/interpreter"]);
  assert.ok(storage.getItem(mod.layoutCacheKey({ name: NAME, bounds: B })));
  // A new session on the same device: from the cache, no request.
  const next = await client(() => json(VALID), storage);
  assert.equal((await next.mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "ready");
  assert.equal(next.calls.length, 0);
});

test("a 200 with an error remark is 'unavailable': nothing cached, a short wait, then a retry (forced by the golfer)", async () => {
  let answer: unknown = ERROR_REMARK;
  const { mod, calls, storage } = await client(() => json(answer));
  const r = await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false });
  assert.equal(r.status, "unavailable");
  assert.equal(storage.getItem(mod.layoutCacheKey({ name: NAME, bounds: B })), null, "no negative cache for a failure");
  // Asked again right away: not hammered.
  assert.equal((await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "unavailable");
  assert.equal(calls.length, 1);
  // Layout off and on (force): asks again, and gets the real answer.
  answer = VALID;
  assert.equal((await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false, force: true })).status, "ready");
  assert.equal(calls.length, 2);
});

test("a genuinely unmapped course is remembered for 7 days, then asked again", async () => {
  const storage = memoryStorage();
  const { mod, calls } = await client(() => json({ version: 0.6, elements: [] }), storage);
  assert.equal((await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "unmapped");
  const key = mod.layoutCacheKey({ name: NAME, bounds: B });
  const day = 24 * 3600 * 1000;
  assert.deepEqual(mod.readLayoutCache(key, Date.now() + 6 * day), { status: "unmapped" });
  assert.equal(mod.readLayoutCache(key, Date.now() + 8 * day), undefined, "expired after 7 days");
  assert.equal(calls.length, 1);
  // Expiry of a layout: 30 days.
  mod.writeLayoutCache("k-ok", { status: "ok", layout: classifyOverpassAnswer(VALID, NAME).kind === "ok" ? (classifyOverpassAnswer(VALID, NAME) as { layout: never }).layout : null }, Date.now() - 29 * day);
  assert.ok(mod.readLayoutCache("k-ok", Date.now()));
  assert.equal(mod.readLayoutCache("k-ok", Date.now() + 2 * day), undefined);
});

test("timeouts and all providers failing end as 'unavailable' (not a silent nothing, not cached)", async () => {
  const t1 = await client(hang);
  assert.equal((await t1.mod.courseLayout({ name: NAME, bounds: B }, { useServer: false, timeoutMs: 30 })).status, "unavailable");
  const t2 = await client(() => json({}, 504));
  assert.equal((await t2.mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "unavailable");
  const t3 = await client(() => Promise.reject(new TypeError("offline")));
  assert.equal((await t3.mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "unavailable");
  assert.equal(t3.storage.m.size, 0);
});

test("the old v1 cache (which could hold a wrong 'no layout' for 30 days) is ignored and cleared", async () => {
  const storage = memoryStorage({ "golfme:courseLayout:v1:forest park golf course|40.6969,-73.8688,40.7027,-73.8590": JSON.stringify({ at: Date.now(), layout: null }) });
  const { mod, calls } = await client(() => json(VALID), storage);
  assert.equal((await mod.courseLayout({ name: NAME, bounds: B }, { useServer: false })).status, "ready");
  assert.equal(calls.length, 1);
  assert.equal([...storage.m.keys()].some((k) => k.startsWith("golfme:courseLayout:v1:")), false);
});

test("real accounts: the layout comes from course-photos; the browser never contacts Overpass", async () => {
  const { mod, calls } = await client(() => json(VALID));
  const asked: unknown[] = [];
  const layout = (classifyOverpassAnswer(VALID, NAME) as { layout: unknown }).layout;
  mod.setDetailServer(async (body: unknown) => {
    asked.push(body);
    return { photos: {}, layouts: { [ID]: { status: "ok", layout } } };
  });
  const r = await mod.courseLayout({ id: ID, name: NAME, bounds: B }, { useServer: true });
  assert.equal(r.status, "ready");
  assert.deepEqual(asked, [{ courseIds: [ID], layout: true }]);
  assert.equal(calls.length, 0, "no direct Overpass request");
});

test("real accounts: a transient server miss is 'unavailable' (no direct fallback); an old server (no `layouts`) or none -> direct", async () => {
  const a = await client(() => json(VALID));
  a.mod.setDetailServer(async () => ({ photos: {}, layouts: {} }));
  assert.equal((await a.mod.courseLayout({ id: ID, name: NAME, bounds: B }, { useServer: true })).status, "unavailable");
  assert.equal(a.calls.length, 0);
  const b = await client(() => json(VALID));
  b.mod.setDetailServer(async () => ({ photos: {}, bounds: {} }));
  assert.equal((await b.mod.courseLayout({ id: ID, name: NAME, bounds: B }, { useServer: true })).status, "ready");
  assert.equal(b.calls.length, 1, "older course-photos: the browser asks overpass-api.de");
  const c = await client(() => json(VALID));
  c.mod.setDetailServer(async () => {
    throw new Error("404 not deployed");
  });
  assert.equal((await c.mod.courseLayout({ id: ID, name: NAME, bounds: B }, { useServer: true })).status, "ready");
});

// ---- the picture ----

const STORAGE_PIC = { url: "https://proj.supabase.co/storage/v1/object/public/course-imagery/naip/v1/x/2048x1500-0badbeef.jpg", bbox: [-8227000, 4968000, -8225000, 4969500], width: 2048, height: 1536 };

test("picture: real accounts get the stored Storage URL; 'none' from the server means tiles only (no render behind its back)", async () => {
  const a = await client(() => json({}));
  a.mod.setDetailServer(async (body: Record<string, unknown>) => {
    assert.deepEqual(body, { courseIds: [ID], picture: true });
    return { photos: {}, pictures: { [ID]: STORAGE_PIC } };
  });
  const p = await a.mod.coursePicture({ id: ID, bounds: B }, { useServer: true, devicePixelRatio: 3 });
  assert.equal(p?.from, "storage");
  assert.equal(p?.url, STORAGE_PIC.url);
  assert.equal(p?.coordinates.length, 4);
  const b = await client(() => json({}));
  b.mod.setDetailServer(async () => ({ photos: {}, pictures: { [ID]: null } }));
  assert.equal(await b.mod.coursePicture({ id: ID, bounds: B }, { useServer: true, devicePixelRatio: 3 }), null);
});

test("picture: demo, an older server or no server -> the USGS export URL; asked once per course per session", async () => {
  const { mod } = await client(() => json({}));
  let asks = 0;
  mod.setDetailServer(async () => {
    asks++;
    return { photos: {}, bounds: {} };
  });
  const p1 = await mod.coursePicture({ id: ID, bounds: B }, { useServer: true, devicePixelRatio: 3 });
  const p2 = await mod.coursePicture({ id: ID, bounds: B }, { useServer: true, devicePixelRatio: 3 });
  assert.equal(p1?.from, "usgs");
  assert.match(p1!.url, /^https:\/\/imagery\.nationalmap\.gov\/arcgis\/rest\/services\/USGSNAIPPlus\/ImageServer\/exportImage\?/);
  assert.equal(p2, p1);
  assert.equal(asks, 1);
  const demo = await mod.coursePicture({ bounds: B }, { useServer: false, devicePixelRatio: 2 });
  assert.equal(demo?.from, "usgs");
});

test("picture download: one request per URL (shared blob: URL), low priority, failures and timeouts not remembered", async () => {
  let mode: "ok" | "fail" | "hang" = "ok";
  const inits: RequestInit[] = [];
  const { mod, calls } = await client((url, init) => {
    inits.push(init ?? {});
    if (mode === "hang") return hang(url, init);
    if (mode === "fail") return Promise.resolve({ ok: false, status: 502, blob: async () => new Blob([]) });
    return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(5000)], { type: "image/jpeg" }) });
  });
  const a = await mod.loadDetailPicture("https://x/a.jpg");
  const a2 = await mod.loadDetailPicture("https://x/a.jpg");
  assert.equal(a.ok, true);
  assert.match(a.objectUrl ?? "", /^blob:/);
  assert.equal(a2.objectUrl, a.objectUrl, "the overview and the still view share one download");
  assert.equal(calls.length, 1);
  assert.equal((inits[0] as { priority?: string }).priority, "low");
  mode = "fail";
  assert.equal((await mod.loadDetailPicture("https://x/b.jpg")).ok, false);
  assert.equal((await mod.loadDetailPicture("https://x/b.jpg")).ok, false);
  assert.equal(calls.length, 3, "a failed picture is asked again next time");
  mode = "hang";
  assert.equal((await mod.loadDetailPicture("https://x/c.jpg", 20)).ok, false);
});

// ---- the status line ----

test("status line: loading only while waiting with Layout on; unmapped / unavailable are shown, nothing when off", () => {
  const base = { loaded: true, canLayout: true, layoutOn: true, result: null };
  assert.equal(layoutUiStatus({ ...base, loaded: false }), "hidden");
  assert.equal(layoutUiStatus({ ...base, canLayout: false }), "hidden");
  assert.equal(layoutUiStatus({ ...base, layoutOn: false }), "off");
  assert.equal(layoutUiStatus(base), "loading");
  assert.equal(layoutUiStatus({ ...base, result: { status: "unmapped" } }), "unmapped");
  assert.equal(layoutUiStatus({ ...base, result: { status: "unavailable" } }), "unavailable");
});

test("the Layout switch is remembered per device ('off' = no layout request later), blocked storage = on", async () => {
  const { readLayoutPreference, writeLayoutPreference, LAYOUT_PREF_KEY } = await import("../src/lib/overviewStatus.ts");
  const s = memoryStorage();
  Object.assign(globalThis, { localStorage: s });
  assert.equal(readLayoutPreference(), true);
  writeLayoutPreference(false);
  assert.equal(s.getItem(LAYOUT_PREF_KEY), "off");
  assert.equal(readLayoutPreference(), false);
  writeLayoutPreference(true);
  assert.equal(readLayoutPreference(), true);
  Object.assign(globalThis, { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } });
  assert.equal(readLayoutPreference(), true);
  writeLayoutPreference(false);
});

test("the new strings exist in all 6 locales", async () => {
  const locales = await Promise.all(["en", "es", "ja", "ko", "zh-CN", "zh-TW"].map((l) => import(`../src/i18n/locales/${l}.ts`)));
  for (const mod of locales) {
    const dict = Object.values(mod)[0] as Record<string, string>;
    for (const k of ["courseMedia.layout", "courseMedia.layoutLoading", "courseMedia.layoutUnmapped", "courseMedia.layoutUnavailable"]) assert.ok(dict[k]?.trim(), k);
  }
});
