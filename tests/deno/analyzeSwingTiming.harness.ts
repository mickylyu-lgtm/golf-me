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
  body?: string;
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
  const call: Call = { url, method, signal: init?.signal, startedAt: vnow(), body: typeof init?.body === "string" ? init.body : undefined };
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

// ANALYZE_SWING_MODULE lets the same scenarios run against an older build
// (e.g. a copy of origin/main's function) for before/after timings; that
// run needs --allow-read. The default stays a static import.
const altModule = Deno.env.get("ANALYZE_SWING_MODULE");
if (altModule) await import(altModule);
else await import("../../supabase/functions/analyze-swing/index.ts");
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

// ---- Stage model (2026-11-08 speedups) ----
// ASSUMED per-stage durations, chosen so the pre-Gemini part adds up to job
// 5f4c8655's ~60 s (production has no per-stage split yet; the stage /
// frames_extracted / pose_ready / gemini_try log lines will give one):
// trim 10 s (fetch original + re-encode), trimmed upload+sign ~instant here,
// coarse extract 12 s (14 s from the larger original), Roboflow 2 s per
// frame call, 48 coarse + 20 dense frames, dense extract 6 s, Gemini
// upload+ACTIVE 8 s, generateContent 15 s.
const MODEL = { trim: 10_000, extract: 12_000, extractOriginal: 14_000, denseExtract: 6_000, roboflow: 2_000, geminiUpload: 8_000, generate: 15_000, coarseFrames: 48, denseFrames: 20 };
const modelFrames = (n: number, fps: number) => Array.from({ length: n }, (_, i) => ({ frameIndex: i, timestampSeconds: Number((i / fps).toFixed(3)), base64: "AAAA" }));
// Wrist velocity peaks mid-clip so the dense pass runs.
const modelRoboflow = (frameNth: number) =>
  json({
    outputs: [
      {
        body_keypoints: { left_shoulder: kp, right_shoulder: kp, left_hip: kp, right_hip: kp, left_wrist: kp, right_wrist: kp },
        body_metrics: { normalized_wrist_y: 0.5, person_confidence: 0.9, wrist_vertical_velocity_normalized_per_frame: frameNth === 24 ? 0.9 : 0.1 },
      },
    ],
  });
function modelRoutes(opts: { echoWindow?: boolean; roboflow?: Responder } = {}): Record<string, Responder> {
  let rf = 0;
  return {
    ...defaultRoutes(),
    trim: (c) => after(c, MODEL.trim, () => new Response(new Uint8Array(512), { status: 200, headers: { "content-type": "video/mp4" } })),
    extract: (c) => {
      const body = JSON.parse(c.body ?? "{}");
      if (typeof body.startSeconds === "number") return after(c, MODEL.denseExtract, () => json({ analysisFps: 20, coordinateScale: 1, frames: modelFrames(MODEL.denseFrames, 20).map((f) => ({ ...f, timestampSeconds: f.timestampSeconds + body.startSeconds })) }));
      const fromOriginal = !!body.sourceWindow;
      return after(c, fromOriginal ? MODEL.extractOriginal : MODEL.extract, () =>
        json({ analysisFps: 8, coordinateScale: 1, frames: modelFrames(MODEL.coarseFrames, 8), sourceWindow: fromOriginal && opts.echoWindow !== false ? body.sourceWindow : undefined }),
      );
    },
    roboflow: opts.roboflow ?? ((c) => after(c, MODEL.roboflow, () => modelRoboflow(++rf))),
    "gemini-finalize": (c) => after(c, MODEL.geminiUpload, () => json({ file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4", state: "ACTIVE" } })),
    "gemini-generate": (c) => after(c, MODEL.generate, generateOk),
  };
}
const count = (route: string) => calls.filter((c) => routeOf(c.url, c.method) === route).length;

Deno.test("stage model: a first analysis (trim + extract in parallel, Roboflow at 16)", async () => {
  reset(modelRoutes());
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  const extracts = calls.filter((c) => routeOf(c.url, c.method) === "extract");
  console.info(`  MODEL first analysis: ${finishedS(row).toFixed(0)} s (extract calls ${extracts.length}, roboflow ${count("roboflow")})`);
  const coarse = extracts.find((c) => JSON.parse(c.body ?? "{}").sourceWindow);
  const trimCall = calls.find((c) => routeOf(c.url, c.method) === "trim");
  assert(coarse && trimCall && Math.abs(coarse.startedAt - trimCall.startedAt) < 2_000, "coarse extraction started together with the trim");
  assertEquals(JSON.parse(coarse!.body!).videoUrl.includes("caddie-x.mov"), true, "from the original, by its signed URL");
  assertEquals(extracts.length, 2, "coarse (original window) + dense (trimmed copy), no re-extraction");
  assert(logEvents("complete")[0]?.thinking_level === "default", "thinking_level logged on complete");
  assertEquals((row.analysis_json as Record<string, unknown>).thinking_level, "default", "and stored with the analysis");
});

Deno.test("stage model: an older extract-frames that ignores sourceWindow is detected; frames re-extracted from the trimmed copy", async () => {
  reset(modelRoutes({ echoWindow: false }));
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete");
  assert(logEvents("source_window_unsupported").length === 1, "fallback logged");
  const extracts = calls.filter((c) => routeOf(c.url, c.method) === "extract").map((c) => JSON.parse(c.body ?? "{}"));
  assertEquals(extracts.length, 3, "original (ignored) + trimmed copy + dense");
  assert(!extracts[1].sourceWindow && extracts[1].videoUrl.includes("caddie-trimmed-"), "re-extracted from the trimmed copy");
  console.info(`  MODEL old extract-frames fallback: ${finishedS(row).toFixed(0)} s`);
});

Deno.test("stage model: a Roboflow 429 burst halves concurrency and the job still completes, uncharged retries", async () => {
  let n = 0;
  let inFlight = 0;
  let maxInFlightAfter429 = 0;
  let saw429 = false;
  reset(
    modelRoutes({
      roboflow: (c) => {
        n++;
        inFlight++;
        if (saw429) maxInFlightAfter429 = Math.max(maxInFlightAfter429, inFlight);
        const res = n >= 5 && n <= 12 ? after(c, 300, () => json({ error: "rate limited" }, 429, { "retry-after": "1" })) : after(c, MODEL.roboflow, () => modelRoboflow(n));
        return res.finally(() => {
          inFlight--;
          if (n >= 5) saw429 = true;
        });
      },
    }),
  );
  await newJob();
  const row = onlyRow();
  assertEquals(row.status, "complete", "complete despite the 429s");
  const throttled = logEvents("roboflow_throttled");
  assert(throttled.length >= 1 && throttled.at(-1)!.concurrency === 4, `throttled down to the floor: ${JSON.stringify(throttled)}`);
  assert(maxInFlightAfter429 <= 16, `never above the cap: ${maxInFlightAfter429}`);
  assertEquals(fake.charges.length, 1, "charged once");
});

Deno.test("stage model: Try again after a Gemini failure reuses the pose work (no extraction, no Roboflow)", async () => {
  // Attempt 1: pose work done, generation fails (permanent 400).
  reset({ ...modelRoutes(), "gemini-generate": (c) => after(c, 500, () => json({ error: { status: "INVALID_ARGUMENT" } }, 400)) });
  await newJob();
  let row = onlyRow();
  assertEquals(row.status, "failed", "attempt 1 failed at generation");
  assertEquals(fake.preprocessing.size, 1, "pose checkpoint kept for the failed row");
  const cp = fake.preprocessing.get(row.id)!;
  assert(!JSON.stringify(cp).includes("SIGNEDTOKEN123") && !JSON.stringify(cp).includes("caddie-x.mov"), "no URL or path stored");
  assert(fake.removed.some((p) => p.includes("caddie-trimmed-")), "attempt 1's trimmed video copy still removed");
  const rfBefore = count("roboflow");
  // Try again with the provider healthy.
  routes["gemini-generate"] = (c) => after(c, MODEL.generate, generateOk);
  const retryAt = vnow();
  await invoke({ retryAnalysisId: row.id });
  row = onlyRow();
  assertEquals([row.status, row.attempt], ["complete", 2], "complete on attempt 2");
  assertEquals(count("roboflow"), rfBefore, "no Roboflow call on the Try again");
  assertEquals(calls.filter((c) => routeOf(c.url, c.method) === "extract" && c.startedAt >= retryAt).length, 0, "no frame extraction on the Try again");
  assertEquals(logEvents("preprocessing_reuse").at(-1)?.verdict, "reuse", "reuse logged");
  assertEquals(fake.preprocessing.size, 0, "checkpoint deleted once the analysis completed");
  assertEquals(fake.charges.length, 1, "charged once");
  const pose = row.roboflow_analysis_json as { frames: unknown[] };
  assert(pose.frames.length > 0, "the complete row carries the reused pose data");
  console.info(`  MODEL Try again with reuse: ${((new RealDate(String(row.updated_at)).getTime() - retryAt) / 1000).toFixed(0)} s`);
});

Deno.test("reuse refused: tampered pose, other trim window, expired -> pose work redone", async () => {
  for (const tamper of ["pose", "window", "expired"] as const) {
    reset({ ...modelRoutes(), "gemini-generate": (c) => after(c, 500, () => json({ error: { status: "INVALID_ARGUMENT" } }, 400)) });
    await newJob();
    const row = onlyRow();
    const cp = fake.preprocessing.get(row.id)!;
    if (tamper === "pose") (cp.pose as { frames: { timestamp_seconds: number }[] }).frames[0].timestamp_seconds = 99;
    // The Try again reads its window from the row (rowTrimWindow).
    if (tamper === "window") Object.assign(row, { trim_start_seconds: 0.5, trim_end_seconds: 6 });
    if (tamper === "expired") cp.created_at = new RealDate(vnow() - 8 * 24 * 3600 * 1000).toISOString();
    routes["gemini-generate"] = (c) => after(c, MODEL.generate, generateOk);
    const rfBefore = count("roboflow");
    await invoke({ retryAnalysisId: row.id });
    const expected = tamper === "pose" ? "bad_signature" : tamper === "window" ? "other_window" : "expired";
    assertEquals(logEvents("preprocessing_reuse").at(-1)?.verdict, expected, `${tamper}: verdict`);
    assert(count("roboflow") > rfBefore, `${tamper}: pose work redone`);
    assertEquals(onlyRow().status, "complete", `${tamper}: still completes`);
  }
});

Deno.test("thinking experiment: off by default; CADDIE_THINKING_LOW_SAMPLE=1 sends thinkingLevel low and logs/stores it", async () => {
  reset(modelRoutes());
  await newJob();
  const body0 = JSON.parse(gens()[0].body!);
  assert(!("thinkingConfig" in body0.generationConfig), "default request unchanged");
  Deno.env.set("CADDIE_THINKING_LOW_SAMPLE", "1");
  try {
    reset(modelRoutes());
    await newJob();
    const body1 = JSON.parse(gens()[0].body!);
    assertEquals(body1.generationConfig.thinkingConfig, { thinkingLevel: "low" }, "low arm");
    assertEquals(logEvents("gemini_try")[0]?.thinking_level, "low", "gemini_try logs it");
    assertEquals(logEvents("complete")[0]?.thinking_level, "low", "complete logs it");
    assertEquals((onlyRow().analysis_json as Record<string, unknown>).thinking_level, "low", "stored");
  } finally {
    Deno.env.delete("CADDIE_THINKING_LOW_SAMPLE");
  }
});
