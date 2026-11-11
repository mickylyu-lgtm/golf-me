import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { CourseImageryThrottle } from "../src/lib/courseImageryThrottle.ts";
import { coursePicture, courseLayout, setDetailServer } from "../src/lib/courseDetailImagery.ts";

const rejected = (status = 429, code = "rate_limited", seconds = 2) => ({
  context: new Response(JSON.stringify({ code, retryAfterSeconds: seconds }), {
    status, headers: { "Retry-After": String(seconds) },
  }),
});
test("budget pauses recognize 429 and only budget-related 503, then expire", async () => {
  const throttle = new CourseImageryThrottle();
  assert.equal(await throttle.record(rejected(), 1000), true);
  assert.equal(throttle.active(2999), true);
  assert.equal(throttle.active(3000), false);
  assert.equal(await throttle.record(rejected(503, "rate_limit_unavailable", 30), 4000), true);
  assert.equal(throttle.active(34000), false);
  assert.equal(await throttle.record(rejected(503, "server_error"), 40000), false);
  assert.equal(await throttle.record(rejected(404), 40000), false);
  assert.equal(await throttle.record(new Error("offline"), 40000), false);
  const dated = { context: new Response("", { status: 429, headers: { "Retry-After": new Date(60000).toUTCString() } }) };
  assert.equal(await throttle.record(dated, 40000), true);
  assert.equal(throttle.active(59999), true);
  assert.equal(throttle.active(60000), false);
});

test("account changes reset pauses, token refresh does not, and stale responses cannot throttle the new account", async () => {
  const throttle = new CourseImageryThrottle();
  let notify: (event: string, session: { user: { id: string } } | null) => void;
  let subscriptions = 0;
  const auth = { onAuthStateChange(callback: typeof notify) { subscriptions++; notify = callback; } };
  throttle.bindAuth(auth); throttle.bindAuth(auth);
  assert.equal(subscriptions, 1);
  notify!("SIGNED_IN", { user: { id: "a" } });
  const oldScope = throttle.scope();
  await throttle.record(rejected(429, "rate_limited", 99999999), 1000);
  assert.equal(throttle.active(1000 + 86400000), false, "untrusted Retry-After is capped at one day");
  notify!("TOKEN_REFRESHED", { user: { id: "a" } });
  assert.equal(throttle.active(2000), true, "refresh must not clear a budget pause");
  notify!("SIGNED_OUT", null);
  assert.equal(throttle.active(2000), false);
  notify!("SIGNED_IN", { user: { id: "b" } });
  assert.equal(await throttle.record(rejected(), 2000, oldScope), true, "old response still suppresses fallback");
  assert.equal(throttle.active(2000), false, "but never pauses the new account");
  await throttle.record(rejected(), 2000);
  notify!("SIGNED_IN", { user: { id: "c" } });
  assert.equal(throttle.active(2000), false, "direct account switch recovers too");
});

test("photos, pictures and layouts suppress fallback and recover after the shared Retry-After window", async () => {
  const oldNow = Date.now;
  let now = oldNow(), photoCalls = 0, directCalls = 0, detailCalls = 0;
  let failure: unknown = rejected();
  Date.now = () => now;
  const g = globalThis as any;
  g.__imageryThrottleFixture = {
    supabase: { auth: { onAuthStateChange() {} }, functions: { invoke: async () => {
      photoCalls++;
      return failure ? { error: failure } : { data: { photos: { fixture: null } }, error: null };
    } } },
    lookup: async () => { directCalls++; return null; },
  };
  const file = new URL("../src/lib/courseImageryClient.ts", import.meta.url);
  const source = readFileSync(file, "utf8")
    .replace(/import \{ useEffect, useState, useSyncExternalStore \} from "react";/, "const useEffect = () => {}; const useState = () => {}; const useSyncExternalStore = () => {};")
    .replace('import { useAuth } from "../context/AuthContext";', "const useAuth = () => ({});")
    .replace('import { supabase } from "./supabase";', "const { supabase } = globalThis.__imageryThrottleFixture;")
    .replace('import { lookupCoursePhoto } from "./coursePhotos";', "const lookupCoursePhoto = globalThis.__imageryThrottleFixture.lookup;")
    .replace(/from "(\.[^"]+)"/g, (_m, ref) => "from " + JSON.stringify(new URL(ref, file).href));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
  const photos = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
  const course = { id: "fixture", name: "Fixture", lat: 40.7, lng: -73.8,
    bounds: { south: 40.6969, west: -73.8688, north: 40.7027, east: -73.859 } };
  try {
    assert.equal(await photos.loadCoursePhoto(course, "thumb", true), null);
    assert.equal(photoCalls, 1);
    assert.equal(await photos.loadCoursePhoto(course, "thumb", true), null);
    assert.equal(photoCalls, 1, "no server requests during the pause");
    setDetailServer(async () => { detailCalls++; return { photos: {}, pictures: { fixture: null }, layouts: {} }; });
    assert.equal(await coursePicture(course, { useServer: true, devicePixelRatio: 1 }), null, "no direct USGS URL");
    assert.equal((await courseLayout(course, { useServer: true })).status, "unavailable");
    assert.equal(detailCalls, 0, "the pause covers all imagery modes");
    now += 2001;
    failure = null;
    assert.equal(await photos.loadCoursePhoto(course, "thumb", true), null);
    assert.equal(photoCalls, 2, "429 did not set the permanent unavailable flag");
    await coursePicture(course, { useServer: true, devicePixelRatio: 1 });
    await courseLayout(course, { useServer: true });
    assert.equal(detailCalls, 2, "pictures/layouts were not cached as permanent failures");
    assert.equal(directCalls, 0);

    const detailCourse = { ...course, id: "detail-rejected", name: "Detail rejected" };
    setDetailServer(async () => { detailCalls++; throw rejected(503, "rate_limit_unavailable", 30); });
    assert.equal(await coursePicture(detailCourse, { useServer: true, devicePixelRatio: 1 }), null);
    assert.equal((await courseLayout(detailCourse, { useServer: true })).status, "unavailable");
    assert.equal(detailCalls, 3, "a detail-origin budget failure also pauses other modes");
    now += 30001;
    setDetailServer(async () => { detailCalls++; return { photos: {}, pictures: { "detail-rejected": null }, layouts: {} }; });
    await coursePicture(detailCourse, { useServer: true, devicePixelRatio: 1 });
    await courseLayout(detailCourse, { useServer: true });
    assert.equal(detailCalls, 5, "detail-origin failures recover after Retry-After");

    // A budget service outage is temporary too; genuine 503 keeps the old fallback.
    failure = rejected(503, "rate_limit_unavailable", 30);
    await photos.loadCoursePhoto({ ...course, id: "outage" }, "hero", true);
    assert.equal(directCalls, 0);
    now += 30001;
    failure = rejected(503, "server_error");
    await photos.loadCoursePhoto({ ...course, id: "down" }, "hero", true);
    assert.equal(directCalls, 1);
  } finally {
    Date.now = oldNow;
    setDetailServer(null);
    delete g.__imageryThrottleFixture;
  }
});
