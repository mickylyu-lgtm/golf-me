// Deno harness for supabase/functions/analyze-swing/index.ts — runs the REAL
// function code with fetch, Supabase (tests/deno/fakeSupabase.ts, mapped in
// tests/deno/deno.json), Deno.serve and EdgeRuntime stubbed. No network, no
// database, no vendor calls.
//
//   deno test --allow-env --config tests/deno/deno.json tests/deno/analyzeSwing.harness.ts
//
// Back-off sleeps are scaled down 1000x (setTimeout below), so step retries
// run in milliseconds.
import { newFakeDb } from "./fakeSupabase.ts";
import type { FakeDb, FakeRow } from "./fakeSupabase.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const USER = "11111111-1111-4111-8111-111111111111";
const GEMINI_KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKE1234567";
Deno.env.set("GEMINI_API_KEY", GEMINI_KEY);
Deno.env.set("ROBOFLOW_API_KEY", "rf-fake-key");
Deno.env.set("FRAME_EXTRACT_SECRET", "frame-secret-fake");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon-fake");

// ---- runtime stubs (before the function module loads) ----
let handler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  handler = h;
  return {};
};
const pending: Promise<unknown>[] = [];
(globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };

const realSetTimeout = globalThis.setTimeout;
let deadlineMs: number | null = null; // when set, the 330 s pipeline deadline fires after this many ms
(globalThis as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number, ...rest: unknown[]) => {
  let d = ms ?? 0;
  if (d === 330_000) d = deadlineMs ?? d;
  else if (d >= 1000) d = Math.max(1, Math.round(d / 1000));
  return realSetTimeout(fn, d, ...rest);
};

const logs: string[] = [];
const realLog = console.log;
const realError = console.error;
console.log = (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
console.error = (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

// ---- scenario-driven fetch ----
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
let calls: Call[] = [];
type Responder = (call: Call, nth: number) => Response | Promise<Response>;
let routes: Record<string, Responder> = {};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const kp = { x: 100, y: 200, confidence: 0.9, metric_reliable: true };
const roboflowOk = () =>
  json({
    outputs: [
      {
        body_keypoints: { left_shoulder: kp, right_shoulder: kp, left_hip: kp, right_hip: kp, left_wrist: kp, right_wrist: kp },
        body_metrics: { normalized_wrist_y: 0.5, person_confidence: 0.9 },
      },
    ],
  });
const phase = { timestamp_seconds: 0.5, confidence: "medium" };
const analysisText = JSON.stringify({
  summary: "Solid swing.",
  camera_angle: "face_on",
  strengths: ["Balance"],
  work_on: [{ issue: "Hip sway", why_it_matters: "Consistency", confidence: "medium" }],
  focus: { title: "Hips", instruction: "Turn, don't slide." },
  drill: { name: "Wall drill", steps: ["Stand near a wall"] },
  limitations: [],
  phases: { address: phase, backswing: phase, top: phase, downswing: phase, impact: { window_start_seconds: 0.6, window_end_seconds: 0.8, confidence: "low" }, follow_through: phase },
  score: Object.fromEntries(["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"].map((k) => [k, { points: 12, reason: "ok" }])),
});

function defaultRoutes(): Record<string, Responder> {
  return {
    "storage-get": () => new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "video/quicktime", "content-length": "1024" } }),
    trim: () => new Response(new Uint8Array(512), { status: 200, headers: { "content-type": "video/mp4" } }),
    extract: () =>
      json({ analysisFps: 8, coordinateScale: 1, frames: Array.from({ length: 12 }, (_, i) => ({ frameIndex: i, timestampSeconds: i / 8, base64: "AAAA" })) }),
    roboflow: () => roboflowOk(),
    "gemini-start": () => new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session/xyz" } }),
    "gemini-finalize": () => json({ file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4", state: "ACTIVE" } }),
    "gemini-poll": () => json({ state: "ACTIVE" }),
    "gemini-generate": () => json({ candidates: [{ content: { parts: [{ text: analysisText }] }, finishReason: "STOP" }] }),
    "gemini-delete": () => json({}),
  };
}

function routeOf(url: string, method: string): string {
  if (url.startsWith("https://proj.supabase.co/storage/")) return "storage-get";
  if (url === "https://golfme.app/api/trim-video") return "trim";
  if (url === "https://golfme.app/api/extract-frames") return "extract";
  if (url.startsWith("https://serverless.roboflow.com/")) return "roboflow";
  if (url.endsWith("/upload/v1beta/files")) return "gemini-start";
  if (url.includes("/upload/session/")) return "gemini-finalize";
  if (url.includes(":generateContent")) return "gemini-generate";
  if (url.includes("/v1beta/files/") && method === "DELETE") return "gemini-delete";
  if (url.includes("/v1beta/files/")) return "gemini-poll";
  return "unknown";
}

(globalThis as unknown as { fetch: unknown }).fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
  const call: Call = { url, method, headers, body: typeof init?.body === "string" ? init.body : undefined };
  calls.push(call);
  const route = routeOf(url, method);
  const responder = routes[route];
  if (!responder) throw new Error(`no route for ${url}`);
  const nth = calls.filter((c) => routeOf(c.url, c.method) === route).length;
  return await responder(call, nth);
};

await import("../../supabase/functions/analyze-swing/index.ts");
assert(handler, "Deno.serve handler captured");

// ---- helpers ----
let fake: FakeDb;
function reset(overrides: Record<string, Responder> = {}) {
  fake = newFakeDb(USER);
  (globalThis as unknown as { __fakeDb: FakeDb }).__fakeDb = fake;
  calls = [];
  logs.length = 0;
  pending.length = 0;
  deadlineMs = null;
  routes = { ...defaultRoutes(), ...overrides };
}

async function invoke(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handler!(new Request("https://fn.local/analyze-swing", { method: "POST", headers: { Authorization: "Bearer user-jwt" }, body: JSON.stringify(body) }));
  const out = { status: res.status, json: (await res.json()) as Record<string, unknown> };
  await Promise.all(pending.splice(0));
  return out;
}

const newJob = (extra: Record<string, unknown> = {}) => invoke({ sourceType: "direct_upload", sourceMediaPath: `${USER}/caddie-x.mov`, ...extra });
const count = (route: string) => calls.filter((c) => routeOf(c.url, c.method) === route).length;
const onlyRow = (): FakeRow => {
  assertEquals(fake.rows.length, 1, "exactly one analysis row");
  return fake.rows[0];
};

function assertNoSecretsAnywhere() {
  const haystacks = [
    ...logs,
    ...fake.rows.map((r) => JSON.stringify(r)),
    ...fake.diagnostics.map((d) => JSON.stringify(d)),
  ];
  for (const h of haystacks) {
    assert(!h.includes(GEMINI_KEY), `Gemini key leaked: ${h.slice(0, 200)}`);
    assert(!h.includes("SIGNEDTOKEN123"), `signed URL token leaked: ${h.slice(0, 200)}`);
    assert(!h.includes("rf-fake-key"), `Roboflow key leaked: ${h.slice(0, 200)}`);
  }
  for (const c of calls) {
    assert(!c.url.includes("key="), `a request URL carries key=: ${c.url}`);
    if (c.url.startsWith("https://generativelanguage.googleapis.com/v1beta") || c.url.endsWith("/upload/v1beta/files")) {
      assertEquals(c.headers["x-goog-api-key"], GEMINI_KEY, `x-goog-api-key header on ${c.url}`);
    }
  }
}

// ---- scenarios ----
Deno.test("happy path: one row, complete, charged once, key only in a header", async () => {
  reset();
  const res = await newJob();
  assertEquals(res.status, 200, "status");
  const row = onlyRow();
  assertEquals([row.status, row.attempt, row.failure_category ?? null], ["complete", 1, null], "row");
  assertEquals(fake.charges.length, 1, "charged once");
  assert(fake.rpcCalls.includes("sweep_stale_caddie_jobs"), "stale sweep ran");
  assert(logs.some((l) => l.includes('"evt":"complete"')), "structured complete log");
  assertNoSecretsAnywhere();
});

Deno.test("transient 503 from extract-frames is retried on the same row and recovers", async () => {
  reset({ extract: (call, nth) => (nth === 1 ? json({ error: "internal" }, 503) : defaultRoutes().extract(call, nth)) });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "recovered");
  assertEquals(count("extract"), 2, "extract called twice");
  assert(logs.some((l) => l.includes('"evt":"step_retry"') && l.includes('"stage":"frame_extract"')), "step_retry logged");
  assertEquals(fake.charges.length, 1, "charged once");
});

Deno.test("persistent 503 fails classified and retryable, after 3 tries, uncharged", async () => {
  reset({ extract: () => json({ error: "internal" }, 503) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.failure_category, row.failure_stage, row.failure_retryable, row.provider_http_status], ["failed", "provider_unavailable", "frame_extract", true, 503], "row");
  assertEquals(count("extract"), 3, "1 call + 2 retries");
  assertEquals(fake.charges.length, 0, "failure not charged");
  assert(String(row.error_message).startsWith("code:provider_busy provider_unavailable@frame_extract"), `error_message ${row.error_message}`);
  assertEquals(fake.diagnostics.length, 1, "one diagnostic row");
  assertNoSecretsAnywhere();
});

Deno.test("an unreadable video (422 decode_failed) is not retried", async () => {
  reset({ extract: () => json({ error: "decode_failed" }, 422) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.failure_category, row.failure_retryable], ["video_unreadable", false], "row");
  assertEquals(count("extract"), 1, "no retry");
});

Deno.test("Roboflow credit cap: quota category, no per-frame retries, no Gemini spend", async () => {
  reset({ roboflow: () => json({ message: "credit_cap_exceeded" }, 403) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.failure_category, row.failure_stage, row.failure_retryable], ["provider_quota_exhausted", "pose", false], "row");
  assertEquals(count("roboflow"), 12, "one call per frame, no retries");
  assertEquals(count("gemini-start"), 0, "Gemini never called");
});

Deno.test("no usable body: pose_not_found before Gemini, with the raw pose counts in the diagnostic", async () => {
  // A person Roboflow sees, but every keypoint below its reliability bar.
  const weak = { x: 100, y: 200, confidence: 0.31, metric_reliable: false };
  reset({
    roboflow: () =>
      json({ outputs: [{ body_keypoints: { left_shoulder: weak, right_shoulder: weak, left_hip: weak, right_hip: weak, left_wrist: weak }, body_metrics: { person_confidence: 0.8 } }] }),
  });
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.failure_category, row.failure_stage, row.failure_retryable], ["failed", "pose_not_found", "pose_gate", false], "row");
  assertEquals(count("gemini-start"), 0, "Gemini never called");
  assertEquals(fake.charges.length, 0, "failure not charged");
  assertEquals(
    fake.diagnostics[0]?.p_detail,
    "usable body in 0/12 (min ratio 0.1) kp_obj 12/12 kp_any 12/12 kp_reliable 0/12 max_kp_conf 0.31 max_person_conf 0.80 frame unknown scale 1",
    "diagnostic detail",
  );
  assert(logs.some((l) => l.includes('"evt":"pose_coverage"') && l.includes('"kp_reliable":0')), "pose_coverage log carries the raw counts");
  assertNoSecretsAnywhere();
});

Deno.test("Roboflow 429 burst: the failed frames are re-run and the job recovers", async () => {
  reset({ roboflow: (_c, nth) => (nth <= 24 ? json({ message: "rate limit" }, 429) : roboflowOk()) });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "recovered");
  assert(logs.some((l) => l.includes('"evt":"step_retry"') && l.includes('"stage":"pose"')), "pose pass retried");
});

Deno.test("Gemini file FAILED = unreadable video, not 'busy'", async () => {
  reset({
    "gemini-finalize": () => json({ file: { name: "files/abc", uri: "u", state: "PROCESSING" } }),
    "gemini-poll": () => json({ state: "FAILED" }),
  });
  await newJob();
  const row = onlyRow();
  assertEquals([row.failure_category, row.failure_stage, row.failure_retryable], ["video_unreadable", "gemini_processing", false], "row");
  assertEquals(count("gemini-generate"), 0, "no generate");
  assert(count("gemini-delete") >= 1, "uploaded file cleaned up");
});

Deno.test("a slow Gemini file (PROCESSING for a while) still completes", async () => {
  reset({
    "gemini-finalize": () => json({ file: { name: "files/abc", uri: "u", state: "PROCESSING" } }),
    "gemini-poll": (_c, nth) => json({ state: nth < 8 ? "PROCESSING" : "ACTIVE" }),
  });
  await newJob();
  assertEquals(onlyRow().status, "complete", "completed after 8 polls (the old code gave up after 6)");
});

Deno.test("a network error carrying the key in its message never reaches a row, diagnostic or log", async () => {
  reset({
    "gemini-generate": () => {
      throw new TypeError(`error sending request for url (https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=${GEMINI_KEY})`);
    },
  });
  await newJob();
  const row = onlyRow();
  assertEquals([row.failure_category, row.failure_stage], ["provider_unavailable", "gemini_generate"], "row");
  assertEquals(count("gemini-generate"), 3, "retried twice");
  assertNoSecretsAnywhere();
});

Deno.test("bad model output gets exactly one more try", async () => {
  reset({
    "gemini-generate": (c, nth) =>
      nth === 1 ? json({ candidates: [{ content: { parts: [{ text: "{not json" }] }, finishReason: "MAX_TOKENS" }] }) : defaultRoutes()["gemini-generate"](c, nth),
  });
  await newJob();
  assertEquals(onlyRow().status, "complete", "second answer used");
  assertEquals(count("gemini-generate"), 2, "two generate calls");
});

Deno.test("a trimmed job never buffers the original and names its copy per attempt", async () => {
  reset();
  await newJob({ startSeconds: 2, endSeconds: 9.5 });
  const row = onlyRow();
  assertEquals(count("storage-get"), 0, "original not fetched by the edge function");
  assertEquals(count("trim"), 1, "trim-video called");
  assertEquals([row.trim_start_seconds, row.trim_end_seconds], [2, 9.5], "window stored on the row");
  assert(String(row.source_media_path).endsWith(`caddie-trimmed-${row.id}-a1.mp4`), `trimmed path ${row.source_media_path}`);
});

Deno.test("a huge untrimmed original fails clearly instead of being buffered", async () => {
  reset({ "storage-get": () => new Response(new Uint8Array(8), { status: 200, headers: { "content-length": String(150 * 1024 * 1024) } }) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.failure_category, row.failure_stage], ["video_too_long_or_large", "media_fetch"], "row");
});

Deno.test("Try again re-runs the SAME row (attempt 2), trims again with a new name, charges once", async () => {
  reset({ trim: (c, nth) => (nth === 1 ? json({ error: "decode_failed" }, 422) : defaultRoutes().trim(c, nth)) });
  await newJob({ startSeconds: 2, endSeconds: 9.5 });
  const failed = onlyRow();
  assertEquals([failed.status, failed.attempt], ["failed", 1], "first attempt failed");
  const res = await invoke({ retryAnalysisId: failed.id, sourceType: "direct_upload", sourceMediaPath: `${USER}/ignored.mov` });
  assertEquals(res.status, 200, "retry accepted");
  const row = onlyRow();
  assertEquals((res.json.analysis as { id: string }).id, failed.id, "same id returned");
  assertEquals([row.status, row.attempt], ["complete", 2], "same row, attempt 2");
  assert(String(row.source_media_path).endsWith(`caddie-trimmed-${row.id}-a2.mp4`), `attempt-2 copy ${row.source_media_path}`);
  assertEquals(fake.charges.length, 1, "charged once");
  assertEquals(fake.starts.map((s) => s.attempt), [1, 2], "two pipeline starts recorded");
});

Deno.test("two concurrent Try agains start exactly one run", async () => {
  reset({ extract: () => json({ error: "decode_failed" }, 422) });
  await newJob();
  const failed = onlyRow();
  routes = defaultRoutes();
  calls = [];
  const [a, b] = await Promise.all([invoke({ retryAnalysisId: failed.id }), invoke({ retryAnalysisId: failed.id })]);
  assertEquals([a.status, b.status], [200, 200], "both answered");
  assertEquals(onlyRow().attempt, 2, "attempt bumped once");
  assertEquals(count("gemini-generate"), 1, "one pipeline run");
  assertEquals(onlyRow().status, "complete", "completed");
});

Deno.test("Try again on a row with no tries left is refused (retry_cap)", async () => {
  reset({ extract: () => json({ error: "decode_failed" }, 422) });
  await newJob();
  const row = onlyRow();
  row.attempt = 4;
  const res = await invoke({ retryAnalysisId: row.id });
  assertEquals([res.status, res.json.code], [429, "retry_cap"], "refused");
});

Deno.test("a late writer from an older attempt can't overwrite the newer one", async () => {
  reset();
  let bumped = false;
  fake.beforeUpdate = (patch) => {
    // Just before the old run's final save, a newer attempt takes the row.
    if (patch.status === "complete" && !bumped) {
      bumped = true;
      Object.assign(fake.rows[0], { attempt: 2, status: "processing" });
    }
  };
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.attempt], ["processing", 2], "newer attempt untouched");
  assertEquals(fake.charges.length, 0, "old run not charged");
  assert(logs.some((l) => l.includes('"evt":"result_discarded"')), "discard logged");
});

Deno.test("the deadline marks the row failed with the stage it was in", async () => {
  reset({ "gemini-generate": () => new Promise<Response>(() => {}) });
  deadlineMs = 300;
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.failure_category, row.failure_stage], ["failed", "deadline_exceeded", "gemini_generate"], "row");
});

Deno.test("Gemini credits depleted: quota category, not retried, not charged", async () => {
  const depleted = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing." },
  });
  reset({ "gemini-generate": () => new Response(depleted, { status: 429, headers: { "content-type": "application/json" } }) });
  await newJob();
  const row = onlyRow();
  assertEquals(
    [row.status, row.failure_category, row.failure_stage, row.failure_retryable, row.provider_http_status],
    ["failed", "provider_quota_exhausted", "gemini_generate", false, 429],
    "row",
  );
  assertEquals(count("gemini-generate"), 1, "no automatic retry");
  assertEquals(fake.charges.length, 0, "allowance not used");
  assert(String(row.error_message).startsWith("code:provider_busy provider_quota_exhausted@gemini_generate"), `error_message ${row.error_message}`);
  assertNoSecretsAnywhere();
});

Deno.test("a Gemini per-minute 429 is retried and recovers", async () => {
  const perMinute = JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel" },
  });
  reset({
    "gemini-generate": (c, nth) => (nth === 1 ? new Response(perMinute, { status: 429 }) : defaultRoutes()["gemini-generate"](c, nth)),
  });
  await newJob();
  assertEquals(onlyRow().status, "complete", "recovered");
  assertEquals(count("gemini-generate"), 2, "retried once");
});

Deno.test("kill switch CADDIE_DISABLED=unavailable refuses before any row or vendor call", async () => {
  reset();
  Deno.env.set("CADDIE_DISABLED", "unavailable");
  try {
    const res = await newJob();
    assertEquals([res.status, res.json.code], [503, "unavailable"], "refused");
    assertEquals(fake.rows.length, 0, "no row");
    assertEquals(calls.length, 0, "no vendor call");
    Deno.env.set("CADDIE_DISABLED", "1");
    const busy = await newJob();
    assertEquals([busy.status, busy.json.code], [503, "provider_busy"], "busy variant");
  } finally {
    Deno.env.delete("CADDIE_DISABLED");
  }
});

Deno.test("refusals carry a stable code for localized copy", async () => {
  reset();
  const bad = await invoke({ sourceType: "nope" });
  assertEquals([bad.status, bad.json.code], [400, "bad_request"], "bad request");
  const notMine = await invoke({ sourceType: "direct_upload", sourceMediaPath: "someone-else/caddie.mov" });
  assertEquals([notMine.status, notMine.json.code], [400, "cant_analyze"], "foreign path");
  await newJob();
  const again = await invoke({ sourceType: "direct_upload", sourceMediaPath: `${USER}/caddie-y.mov` });
  assertEquals([again.status, again.json.code], [429, "cooldown"], "cooldown");
});

// Restore console so Deno's own reporter output is visible.
globalThis.addEventListener("unload", () => {
  console.log = realLog;
  console.error = realError;
});
