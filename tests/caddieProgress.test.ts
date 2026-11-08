// Run: npm run test:caddie  (node --test, built-in type stripping)
// The processing screen's truthful progress (src/lib/caddieProgress.ts) and
// the bounded history read RealCaddieContext relies on (supabase-js's
// abortSignal really ends a hung request, so the one-at-a-time lock is
// released).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { CHECKING_AFTER_MS, SLOW_AFTER_MS, WRITING_RETRY_AFTER_MS, caddieProgress, formatElapsed } from "../src/lib/caddieProgress.ts";
import { GEMINI_GENERATE_TRY_TIMEOUTS_MS, WORKER_LOST_MS } from "../supabase/functions/_shared/caddieReliability.ts";

const T0 = Date.parse("2026-11-08T19:35:35Z");
const iso = (ms: number) => new Date(ms).toISOString();
const job = (stage: string, stageAtS: number) => ({ stage, stageUpdatedAt: iso(T0 + stageAtS * 1000), attemptStartedAt: iso(T0), createdAt: iso(T0 - 3_600_000) });

test("the step shown is the stage the server last persisted", () => {
  assert.equal(caddieProgress(job("trim", 0), T0 + 5_000).step, "preparing");
  assert.equal(caddieProgress(job("frame_extract", 10), T0 + 20_000).step, "pose");
  assert.equal(caddieProgress(job("pose", 20), T0 + 30_000).step, "pose");
  assert.equal(caddieProgress(job("gemini_upload", 50), T0 + 55_000).step, "sending");
  assert.equal(caddieProgress(job("gemini_generate", 60), T0 + 70_000).step, "writing");
  assert.equal(caddieProgress({ createdAt: iso(T0) }, T0 + 1_000).step, "preparing");
});

test("elapsed is measured from THIS attempt's start, not the row's creation", () => {
  const p = caddieProgress(job("pose", 20), T0 + 75_000);
  assert.equal(p.elapsedSeconds, 75);
  assert.equal(formatElapsed(p.elapsedSeconds), "1:15");
  assert.equal(formatElapsed(0), "0:00");
});

test("job 5f4c8655's shape: working, then 'retrying automatically' once the first try's timeout passes, then slow, then checking", () => {
  // Generation began ~60 s in.
  assert.deepEqual(caddieProgress(job("gemini_generate", 60), T0 + 90_000), { step: "writing", phase: "working", retrying: false, elapsedSeconds: 90 });
  const retrying = caddieProgress(job("gemini_generate", 60), T0 + 60_000 + WRITING_RETRY_AFTER_MS + 1_000);
  assert.equal(retrying.retrying, true);
  assert.equal(retrying.phase, "slow");
  // Slow without being on a retry (a long pose pass).
  assert.equal(caddieProgress(job("pose", 20), T0 + SLOW_AFTER_MS + 1_000).phase, "slow");
  assert.equal(caddieProgress(job("pose", 20), T0 + SLOW_AFTER_MS + 1_000).retrying, false);
  // Past the server deadline + sweep margin: checking, never "failed".
  assert.equal(caddieProgress(job("gemini_generate", 60), T0 + CHECKING_AFTER_MS + 1_000).phase, "checking");
});

test("thresholds agree with the server", () => {
  // "Retrying" is only claimed after the server's first try really ended.
  assert.ok(WRITING_RETRY_AFTER_MS > GEMINI_GENERATE_TRY_TIMEOUTS_MS[0]);
  // "Checking" (and the app's sweep) only after the database would sweep.
  assert.ok(CHECKING_AFTER_MS > WORKER_LOST_MS);
});

test("a hung history read is ended by abortSignal (the lock can't be held forever)", async () => {
  let sawSignal = false;
  const hangingFetch = (_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      sawSignal = !!signal;
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("aborted", "AbortError")));
    });
  const client = createClient("http://127.0.0.1:9", "anon", { global: { fetch: hangingFetch as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const started = Date.now();
  const { data, error } = await client.from("caddie_analyses").select("id").eq("owner_id", "x").abortSignal(controller.signal);
  assert.equal(sawSignal, true, "the signal reached fetch");
  assert.equal(data, null);
  assert.ok(error, "the read settles with an error instead of hanging");
  assert.ok(Date.now() - started < 2_000);
});
