// Timing harness for supabase/functions/analyze-swing/index.ts (2026-11-08,
// job 5f4c8655): runs the REAL function on a VIRTUAL clock, so hung and slow
// provider requests can be reproduced against the real timeouts, retry
// budget and 330 s deadline. Every timer, AbortSignal.timeout and Date.now
// run SCALE times faster than real time (1 real ms = SCALE virtual ms), so a
// 330 s pipeline takes ~3.3 s. Mocked providers only: fetch, Supabase
// (tests/deno/fakeSupabase.ts), Deno.serve and EdgeRuntime are stubbed. No
// network, no database, no vendor call.
//
//   deno test --no-check --allow-env --config tests/deno/deno.json tests/deno/analyzeSwingTiming.harness.ts
//
// Virtual times are approximate (the function's own CPU time is scaled
// too), so assertions use generous windows.
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

// ---- virtual clock ----
const SCALE = 100;
const realNow = Date.now.bind(Date);
const epoch = realNow();
const vnow = () => epoch + (realNow() - epoch) * SCALE;
Date.now = vnow;
const RealDate = Date;
// `new Date()` (no args) reads the virtual clock too, so ISO stamps written
// by the function and compared by the fake DB agree.
class VirtualDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(vnow());
    else super(...(args as [string]));
  }
  static override now() {
    return vnow();
  }
}
(globalThis as unknown as { Date: unknown }).Date = VirtualDate;

const realSetTimeout = globalThis.setTimeout;
(globalThis as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number, ...rest: unknown[]) =>
  realSetTimeout(fn, Math.max(0, Math.round((ms ?? 0) / SCALE)), ...rest);
const vsleep = (virtualMs: number) => new Promise<void>((r) => realSetTimeout(r, Math.max(1, Math.round(virtualMs / SCALE))));
AbortSignal.timeout = (ms: number) => {
  const c = new AbortController();
  realSetTimeout(() => c.abort(new DOMException("The signal has been aborted", "TimeoutError")), Math.max(1, Math.round(ms / SCALE)));
  return c.signal;
};

// ---- runtime stubs ----
let handler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  handler = h;
  return {};
};
const pending: Promise<unknown>[] = [];
(globalThis as unknown as { EdgeRuntime: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => pending.push(p) };

const logs: string[] = [];
console.log = (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
console.error = (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

// ---- scenario-driven fetch that honors AbortSignal ----
interface Call {
  url: string;
  method: string;
  signal?: AbortSignal | null;
  startedAt: number;
  endedAt?: number;
  outcome?: "ok" | "aborted";
}
let calls: Call[] = [];
type Responder = (call: Call, nth: number) => Promise<Response>;
let routes: Record<string, Responder> = {};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// Resolves after `virtualMs`, or rejects with the signal's reason when the
// caller aborts first (exactly what a real fetch does).
function after(call: Call, virtualMs: number, make: () => Response): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = call.signal;
    if (signal?.aborted) return reject(signal.reason);
    let done = false;
    const t = realSetTimeout(() => {
      done = true;
      resolve(make());
    }, Math.max(1, Math.round(virtualMs / SCALE)));
    signal?.addEventListener("abort", () => {
      if (done) return; // answered first; a later abort is a no-op, like a real fetch
      clearTimeout(t);
      call.outcome = "aborted";
      call.endedAt = vnow();
      reject(signal.reason);
    });
  });
}
const hang = (call: Call) => after(call, 10 * 60 * 1000, () => json({ late: true }));

const kp = { x: 100, y: 200, confidence: 0.9, metric_reliable: true };
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
const generateOk = () => json({ candidates: [{ content: { parts: [{ text: analysisText }] }, finishReason: "STOP" }] });

// Pre-Gemini work takes ~55-60 virtual s, like job 5f4c8655 (trim + frames +
// pose passed, generation began ~60 s in); a healthy generateContent ~15 s
// (attempt 2's retry recovered ~15 s after it started).
const PRE_GEMINI_MS = 55_000;
const HEALTHY_GENERATE_MS = 15_000;

function defaultRoutes(): Record<string, Responder> {
  return {
    "storage-get": (c) => after(c, 500, () => new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "video/quicktime", "content-length": "1024" } })),
    trim: (c) => after(c, 5_000, () => new Response(new Uint8Array(512), { status: 200, headers: { "content-type": "video/mp4" } })),
    extract: (c, nth) =>
      after(c, nth === 1 ? PRE_GEMINI_MS - 10_000 : 1_000, () =>
        json({ analysisFps: 8, coordinateScale: 1, frames: Array.from({ length: 12 }, (_, i) => ({ frameIndex: i, timestampSeconds: i / 8, base64: "AAAA" })) }),
      ),
    roboflow: (c) =>
      after(c, 1_000, () =>
        json({ outputs: [{ body_keypoints: { left_shoulder: kp, right_shoulder: kp, left_hip: kp, right_hip: kp, left_wrist: kp, right_wrist: kp }, body_metrics: { normalized_wrist_y: 0.5, person_confidence: 0.9 } }] }),
      ),
    "gemini-start": (c) => after(c, 300, () => new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session/xyz" } })),
    "gemini-finalize": (c) => after(c, 2_000, () => json({ file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4", state: "ACTIVE" } })),
    "gemini-poll": (c) => after(c, 200, () => json({ state: "ACTIVE" })),
    "gemini-generate": (c) => after(c, HEALTHY_GENERATE_MS, generateOk),
    "gemini-delete": (c) => after(c, 100, () => json({})),
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
  const call: Call = { url, method, signal: init?.signal, startedAt: vnow() };
  calls.push(call);
  const route = routeOf(url, method);
  const responder = routes[route];
  if (!responder) throw new Error(`no route for ${url}`);
  const nth = calls.filter((c) => routeOf(c.url, c.method) === route).length;
  const res = await responder(call, nth);
  call.outcome = "ok";
  call.endedAt = vnow();
  return res;
};

await import("../../supabase/functions/analyze-swing/index.ts");
assert(handler, "Deno.serve handler captured");

// ---- helpers ----
let fake: FakeDb;
let jobStart = 0;
function reset(overrides: Record<string, Responder> = {}) {
  fake = newFakeDb(USER);
  (globalThis as unknown as { __fakeDb: FakeDb }).__fakeDb = fake;
  calls = [];
  logs.length = 0;
  pending.length = 0;
  routes = { ...defaultRoutes(), ...overrides };
}

async function invoke(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  jobStart = vnow();
  const res = await handler!(new Request("https://fn.local/analyze-swing", { method: "POST", headers: { Authorization: "Bearer user-jwt" }, body: JSON.stringify(body) }));
  const out = { status: res.status, json: (await res.json()) as Record<string, unknown> };
  await Promise.all(pending.splice(0));
  return out;
}

// A golfer-picked trim window, like the production job (trim ran).
const newJob = () => invoke({ sourceType: "direct_upload", sourceMediaPath: `${USER}/caddie-x.mov`, startSeconds: 0, endSeconds: 6 });
const gens = () => calls.filter((c) => routeOf(c.url, c.method) === "gemini-generate");
const onlyRow = (): FakeRow => {
  assertEquals(fake.rows.length, 1, "exactly one analysis row");
  return fake.rows[0];
};
const finishedS = (row: FakeRow) => (new RealDate(String(row.updated_at)).getTime() - jobStart) / 1000;
const sec = (ms: number) => Math.round(ms / 1000);
function genTimeline(): string {
  return gens()
    .map((c) => `${sec(c.startedAt - jobStart)}s->${c.endedAt ? sec(c.endedAt - jobStart) : "open"}s ${c.outcome ?? "open"}`)
    .join(", ");
}
const logEvents = (evt: string) => logs.filter((l) => l.includes(`"evt":"${evt}"`)).map((l) => JSON.parse(l) as Record<string, unknown>);

// Waits (virtual time) for anything the function left running in the
// background, so a still-open request that resolves late is observable.
const drain = (virtualMs: number) => vsleep(virtualMs);

// ---- scenarios ----
Deno.test("healthy: one generateContent, complete in about a minute and a quarter", async () => {
  reset();
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  assertEquals(gens().length, 1, "one generate call");
  assertEquals(fake.charges.length, 1, "charged once");
  const s = finishedS(row);
  assert(s > 60 && s < 110, `finished at ~75 s, got ${s}`);
  console.info(`  healthy finished at ${s.toFixed(0)} s; gens: ${genTimeline()}`);
});

Deno.test("job 5f4c8655 attempt 1: every generateContent hangs -> bounded tries, aborted, useful terminal failure before the deadline", async () => {
  reset({ "gemini-generate": (c) => hang(c) });
  await newJob();
  const row = onlyRow();
  console.info(`  attempt-1 repro: ${row.status} ${row.failure_category}@${row.failure_stage} at ${finishedS(row).toFixed(0)} s; gens: ${genTimeline()}`);
  assertEquals(row.status, "failed", "failed");
  assertEquals(row.failure_stage, "gemini_generate", "stage");
  assertEquals(fake.charges.length, 0, "a failure never uses a slot");
  // The terminal state lands before the 330 s deadline, as a classified
  // provider timeout rather than deadline_exceeded.
  assertEquals(row.failure_category, "provider_unavailable", "category");
  assert(finishedS(row) < 330, `terminal write before the deadline, got ${finishedS(row)}`);
  // Every try was actually aborted (released), none left open.
  await drain(60_000);
  assert(gens().every((c) => c.outcome === "aborted"), `every hung try aborted: ${genTimeline()}`);
  assert(gens().length >= 2 && gens().length <= 3, `bounded tries, got ${gens().length}`);
  // No try was started that couldn't finish before the deadline.
  for (const c of gens()) assert(c.startedAt - jobStart < 330_000 - 30_000, `try started too late: ${genTimeline()}`);
  const retry = logEvents("step_retry").find((e) => e.stage === "gemini_generate");
  assert(retry && retry.kind === "timeout" && typeof retry.request_timeout_ms === "number" && retry.model, `telemetry: ${JSON.stringify(retry)}`);
  const diag = fake.diagnostics.at(-1) as Record<string, unknown> | undefined;
  assert(diag && String(diag.p_detail).includes("timeout"), `diagnostic says timeout: ${JSON.stringify(diag)}`);
});

Deno.test("job 5f4c8655 attempt 2: first generateContent hangs, the retry answers in ~15 s -> complete well under the old ~4 min", async () => {
  reset({ "gemini-generate": (c, nth) => (nth === 1 ? hang(c) : after(c, HEALTHY_GENERATE_MS, generateOk)) });
  await newJob();
  const row = onlyRow();
  console.info(`  attempt-2 repro: ${row.status} at ${finishedS(row).toFixed(0)} s; gens: ${genTimeline()}`);
  assertEquals(row.status, "complete", "complete");
  assertEquals(fake.charges.length, 1, "charged once");
  assert(finishedS(row) < 160, `recovered quickly, got ${finishedS(row)}`);
  await drain(60_000);
  assertEquals(gens()[0].outcome, "aborted", "the hung try was aborted, not left running");
});

Deno.test("a slow-but-healthy generateContent (50 s) is NOT cut off and re-bought", async () => {
  reset({ "gemini-generate": (c) => after(c, 50_000, generateOk) });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  assertEquals(gens().length, 1, "no duplicate generation");
});

Deno.test("a late response from attempt 1 can't overwrite attempt 2", async () => {
  // Attempt 1 hangs; while it hangs a newer attempt takes the row (another
  // worker). Attempt 1's eventual outcome must not touch it, nor remove the
  // newer attempt's files.
  reset({ "gemini-generate": (c) => hang(c) });
  let bumped = false;
  fake.beforeUpdate = (patch) => {
    if (!bumped && patch.status === "failed") {
      bumped = true;
      Object.assign(fake.rows[0], { attempt: 2, status: "processing" });
    }
  };
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.attempt], ["processing", 2], "newer attempt untouched");
  assertEquals(fake.diagnostics.length, 0, "no diagnostic written for a row this attempt no longer owns");
  assertEquals(fake.removed.length, 0, "the stale attempt removed nothing");
});

Deno.test("deadline exhaustion (slow pre-Gemini work + hung generation) persists a useful failure, never endless processing", async () => {
  reset({
    extract: (c, nth) =>
      // 110 s: just under extract's own 120 s timeout, so generation only
      // starts at ~120 s and the deadline, not the try count, binds.
      after(c, nth === 1 ? 110_000 : 1_000, () =>
        json({ analysisFps: 8, coordinateScale: 1, frames: Array.from({ length: 12 }, (_, i) => ({ frameIndex: i, timestampSeconds: i / 8, base64: "AAAA" })) }),
      ),
    "gemini-generate": (c) => hang(c),
  });
  await newJob();
  const row = onlyRow();
  console.info(`  late-start: ${row.status} ${row.failure_category}@${row.failure_stage} at ${finishedS(row).toFixed(0)} s; gens: ${genTimeline()}`);
  assertEquals(row.status, "failed", "failed");
  assert(finishedS(row) <= 335, `failed by the deadline, got ${finishedS(row)}`);
  await drain(60_000);
  assert(gens().every((c) => c.outcome === "aborted"), `no request left running: ${genTimeline()}`);
});

Deno.test("429 asking to wait 60 s is not retried early: fails fast as rate-limited, uncharged", async () => {
  reset({ "gemini-generate": (c) => after(c, 1_000, () => json({ error: { status: "RESOURCE_EXHAUSTED", message: "per minute" } }, 429, { "retry-after": "60" })) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.failure_category], ["failed", "provider_rate_limited"], "rate limited");
  assertEquals(gens().length, 1, "no early retry against the provider's Retry-After");
  assert(finishedS(row) < 90, `failed fast, got ${finishedS(row)}`);
  assertEquals(fake.charges.length, 0, "uncharged");
});

Deno.test("429 asking to wait 5 s is honored and recovers", async () => {
  reset({
    "gemini-generate": (c, nth) =>
      nth === 1
        ? after(c, 500, () => json({ error: { status: "RESOURCE_EXHAUSTED", message: "per minute" } }, 429, { "retry-after": "5" }))
        : after(c, HEALTHY_GENERATE_MS, generateOk),
  });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  const g = gens();
  assert(g[1].startedAt - (g[0].endedAt ?? 0) >= 4_500, `waited ~5 s: ${genTimeline()}`);
});

Deno.test("a permanent 400 from generateContent is not retried", async () => {
  reset({ "gemini-generate": (c) => after(c, 500, () => json({ error: { status: "INVALID_ARGUMENT" } }, 400)) });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "failed", "failed");
  assertEquals(gens().length, 1, "one call");
});

Deno.test("a network error is classified as network (not timeout), retried, complete", async () => {
  reset({
    "gemini-generate": (c, nth) => (nth === 1 ? Promise.reject(new TypeError("error sending request")) : after(c, HEALTHY_GENERATE_MS, generateOk)),
  });
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  assertEquals(logEvents("gemini_try").map((e) => e.outcome), ["network", "responded"], "per-try outcomes");
  assertEquals(logEvents("step_retry").map((e) => e.kind), ["network"], "retry kind");
});

Deno.test("two malformed answers: model_output_invalid after exactly 2 tries (existing rule), uncharged", async () => {
  reset({ "gemini-generate": (c) => after(c, 2_000, () => json({ candidates: [{ content: { parts: [{ text: "{not json" }] }, finishReason: "STOP" }] })) });
  await newJob();
  const row = onlyRow();
  assertEquals([row.status, row.failure_category], ["failed", "model_output_invalid"], "classified");
  assertEquals(gens().length, 2, "two tries");
  assertEquals(fake.charges.length, 0, "uncharged");
});

Deno.test("first analysis of a brand-new account: hung provider -> honest failure, no slot used -> Try again succeeds, charged once", async () => {
  // Attempt 1: every generateContent hangs (job 5f4c8655's attempt 1).
  reset({ "gemini-generate": (c) => hang(c) });
  const first = await newJob();
  assertEquals(first.status, 200, "accepted");
  let row = onlyRow();
  assertEquals([row.status, row.attempt, row.failure_retryable], ["failed", 1, true], "attempt 1 failed, retryable");
  assertEquals(fake.charges.length, 0, "the failure used no allowance slot");
  // Try again (the app's button): same row, attempt 2, provider healthy now.
  routes["gemini-generate"] = (c) => after(c, HEALTHY_GENERATE_MS, generateOk);
  const retry = await invoke({ retryAnalysisId: row.id });
  assertEquals(retry.status, 200, "retry accepted");
  row = onlyRow();
  assertEquals([row.status, row.attempt], ["complete", 2], "attempt 2 complete on the same row");
  assertEquals(fake.charges.length, 1, "charged exactly once, for the delivered analysis");
  assertEquals(fake.starts.length, 2, "two pipeline starts recorded");
  // A double tap of Try again on the completed row starts nothing.
  const again = await invoke({ retryAnalysisId: row.id });
  assertEquals([again.status, (again.json.analysis as FakeRow).status], [200, "complete"], "idempotent");
  assertEquals(fake.starts.length, 2, "no third start");
});
