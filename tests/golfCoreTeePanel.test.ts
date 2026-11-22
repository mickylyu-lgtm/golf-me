import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GOLFCORE_TEE_PILOT_ROW_COUNTS, isGolfCoreTeePilotCourse } from "../src/lib/golfCoreTeePilot.ts";
import { BAYONNE_OFFICIAL_COURSE_ID, bayonneOfficialTeeRatings } from "../src/lib/bayonneOfficialTeeRatings.ts";

// Vercel emits TS as .js and requires emitted-path ESM specifiers.
// Map only this dependency graph for Node's direct source test.
const serverParent = new URL("../server/golfCoreTeePanel.ts", import.meta.url).href;
const handlerParent = new URL("../api/course-tee-panel.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL === serverParent || context.parentURL === handlerParent) && specifier.startsWith(".") && specifier.endsWith(".js")) {
      return nextResolve(specifier.slice(0, -3) + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { createGolfCoreTeePanelHandler } = await import("../api/course-tee-panel.ts");
const { parseGolfCoreTeePanelRequest, readGolfCoreTeeSnapshot, renderGolfCoreTeePanel } = await import("../server/golfCoreTeePanel.ts");
hooks.deregister();

const courseIds = Object.keys(GOLFCORE_TEE_PILOT_ROW_COUNTS);
const first = courseIds[0];
const validNow = Date.parse("2026-11-22T00:00:00Z");
const expiry = Date.parse("2027-02-20T00:00:00Z");

function fixture(): Record<string, unknown[][]> {
  return Object.fromEntries(courseIds.map((id, i) => [
    id,
    Array.from({ length: GOLFCORE_TEE_PILOT_ROW_COUNTS[id] }, (_, j) => [
      "Synthetic " + String.fromCharCode(65 + i, 65 + j),
      j % 2 ? "women" : "men",
      83 + j / 10,
      140 + j,
    ]),
  ]));
}
const snapshot = readGolfCoreTeeSnapshot(JSON.stringify(fixture()));
assert.ok(snapshot);

type Request = Pick<VercelRequest, "method" | "headers" | "query" | "body">;
const defaults: Request = {
  method: "POST", headers: { origin: "https://golfme.app", authorization: "Bearer synthetic.token" }, query: {},
  body: { courseId: first, locale: "en" },
};
async function send(
  request: Partial<Request> = {},
  overrides: Partial<Parameters<typeof createGolfCoreTeePanelHandler>[0]> = {},
) {
  const headers = new Map<string, string>();
  let status = 200;
  let markup: string | undefined;
  let authCalls = 0;
  const res = {
    setHeader(k: string, v: string) { headers.set(k, v); return this; },
    status(n: number) { status = n; return this; },
    end() { return this; },
    send(value: string) { markup = value; return this; },
  } as unknown as VercelResponse;
  const handler = createGolfCoreTeePanelHandler({
    async authorize(token) { authCalls++; return token === "synthetic.token"; },
    snapshot,
    now: () => validNow,
    ...overrides,
  });
  await handler({ ...defaults, ...request } as VercelRequest, res);
  return { status, headers, markup, authCalls };
}

test("exact roster of nine catalog courses/42 full-round rows excludes Bayonne and non-reviewed lookalikes", () => {
  assert.equal(courseIds.length, 9);
  assert.equal(Object.values(GOLFCORE_TEE_PILOT_ROW_COUNTS).reduce((sum, x) => sum + x, 0), 42);
  for (const id of [BAYONNE_OFFICIAL_COURSE_ID, first.toUpperCase(), "toString", undefined, "liberty-national", "skyway"]) {
    assert.ok(!isGolfCoreTeePilotCourse(id));
  }
  assert.deepEqual(bayonneOfficialTeeRatings(BAYONNE_OFFICIAL_COURSE_ID, validNow)?.tees.map((x) => x.name), ["Black", "Green", "Blue", "White", "Red"]);
});

test("atomic private-config validation rejects incomplete, duplicate, non-18-hole or malformed records", () => {
  for (const malformed of [undefined, "{", "{}", JSON.stringify({ ...fixture(), [BAYONNE_OFFICIAL_COURSE_ID]: [] }), JSON.stringify({ ...fixture(), [first]: [] }), " ".repeat(16_500)]) {
    assert.equal(readGolfCoreTeeSnapshot(malformed), null);
  }
  for (const tee of [
    ["<script>", "men", 80, 150], ["Blue", "all", 80, 150], ["Blue", "men", 80.123, 150], ["Blue", "men", 80, 54], ["Blue", "men", 80, 156],
    ["Blue", "men", 80, 150.5], ["Blue", "men", 80, 150, "front nine"], ["Blue", "men", null, 150],
  ]) {
    const input = fixture();
    input[first][0] = tee;
    assert.equal(readGolfCoreTeeSnapshot(JSON.stringify(input)), null);
  }
  const duplicate = fixture();
  duplicate[first][1] = [duplicate[first][0][0], "men", 81, 146];
  assert.equal(readGolfCoreTeeSnapshot(JSON.stringify(duplicate)), null);
});

test("single display response is scriptless attributed HTML; no other course, exports or unverified figures", async () => {
  const result = await send();
  assert.equal(result.status, 200);
  assert.equal(result.authCalls, 1);
  assert.equal(result.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(result.headers.get("X-GolfMe-View"), "course-tee-panel-v1");
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal(result.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(result.headers.get("Content-Security-Policy")!, /default-src 'none'.*frame-ancestors 'none'/);
  assert.ok(!result.headers.has("Access-Control-Allow-Origin"));
  assert.match(result.markup!, /<table><caption>18 holes<\/caption>/);
  assert.match(result.markup!, /Synthetic AA.*83\.0/);
  assert.match(result.markup!, /https:\/\/www.golfcore.org\/courses\/dyker-beach-golf-course\/.*>GolfCore<\/a>/);
  assert.match(result.markup!, /113 is standard/);
  assert.equal((result.markup!.match(/scope="row"/g) ?? []).length, 4);
  assert.doesNotMatch(result.markup!, /Synthetic BA|Bogey Rating|Front 9|Back 9|<script|data:text|download=/);
});

test("block unsigned, rejected, cross-origin, bulk, query-string and locale injection attempts", async () => {
  for (const [input, status, authCalls] of [
    [{ method: "GET" }, 405, 0],
    [{ method: "OPTIONS" }, 405, 0],
    [{ headers: {} }, 401, 0],
    [{ headers: { authorization: "Bearer refused" } }, 401, 1],
    [{ headers: { origin: "https://golfme.app.example", authorization: "Bearer synthetic.token" } }, 403, 0],
    [{ body: { courseIds, locale: "en" } }, 400, 0],
    [{ body: { courseId: [first], locale: "en" } }, 400, 0],
    [{ body: { courseId: BAYONNE_OFFICIAL_COURSE_ID, locale: "en" } }, 400, 0],
    [{ query: { all: "1" } }, 400, 0],
    [{ body: { courseId: first, locale: "en<script>" } }, 400, 0],
    [{ body: { courseId: first, locale: "en", format: "json" } }, 400, 0],
  ] as const) {
    const result = await send(input as Partial<Request>);
    assert.equal(result.status, status);
    assert.equal(result.authCalls, authCalls);
    assert.equal(result.markup, undefined);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  const authFailure = await send({}, { async authorize() { throw Error("synthetic outage"); } });
  assert.equal(authFailure.status, 503);
  assert.equal(authFailure.markup, undefined);
});

test("an unset or expired review sends no content and no vendor fallback", async () => {
  for (const override of [{ snapshot: null }, { now: () => validNow - 1 }, { now: () => expiry }]) {
    const result = await send({}, override);
    assert.equal(result.status, 404);
    assert.equal(result.markup, undefined);
  }
  assert.equal((await send({}, { now: () => expiry - 1 })).status, 200);
});

test("locales preserve the source and true tee labels; only explicit colors have swatches", () => {
  for (const locale of ["en", "es", "ko", "ja", "zh-CN", "zh-TW"]) {
    const parsed = parseGolfCoreTeePanelRequest({ courseId: first, locale });
    assert.ok(parsed);
    const rendered = renderGolfCoreTeePanel({
      slug: "synthetic-course",
      tees: [["Blue", "men", 82.6, 115], ["White/Gold", "women", 84.7, 116], ["Synthetic", "men", 88, 117]],
    }, parsed.locale);
    assert.match(rendered, new RegExp('<html lang="' + locale + '"'));
    assert.equal((rendered.match(/class="swatch"/g) ?? []).length, 1);
    assert.match(rendered, /White\/Gold/);
    assert.match(rendered, /GolfCore<\/a>/);
  }
});

test("only the course details view consumes this sandboxed document and the public client does not import snapshot parsing", () => {
  const details = readFileSync(new URL("../src/components/courses/CourseDetailContent.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/courses/GolfCoreTeeRatings.tsx", import.meta.url), "utf8");
  assert.match(details, /isAuthenticated && !isDemo && .*isGolfCoreTeePilotCourse\(course.id\)/);
  assert.match(details, /golfCorePilot \? null : courseTeeRatingsSource/);
  assert.match(panel, /if \(!open\) return/);
  assert.match(panel, /sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(panel, /allow-scripts|allow-same-origin|server\/golfCoreTeePanel|process\.env/);
});
