import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { translationRequestError, translationRetryDelay } from "../src/lib/caddieTranslationRetry.ts";
import * as language from "../src/lib/caddieLanguage.ts";
import * as queue from "../src/lib/caddieAutoTranslate.ts";

const limited = (seconds = 86400) => Object.assign(new Error("limited"), { status: 429, code: "rate_limited", retryAfterSeconds: seconds });
test("preserves 429 metadata and body without consuming the original response", async () => {
  const response = new Response(JSON.stringify({ error: "Wait", code: "rate_limited", retryAfterSeconds: 86400 }), { status: 429, headers: { "Retry-After": "86400" } });
  const error = await translationRequestError({ message: "HTTP error", context: response });
  assert.equal(error.message, "Wait");
  assert.equal(translationRetryDelay(error), 86400000);
  assert.equal((await response.json()).code, "rate_limited");
});
test("header/date/body priority, malformed fallback and bounded delays", () => {
  assert.equal(translationRetryDelay({ status: 429, retryAfter: "61", retryAfterSeconds: 90 }), 61000);
  assert.equal(translationRetryDelay({ status: 429, retryAfter: new Date(90000).toUTCString() }, 1, 1000), 89000);
  for (const retryAfter of ["", "-3", "NaN", "garbage"]) assert.equal(translationRetryDelay({ status: 429, retryAfter, retryAfterSeconds: 60 }), 60000);
  assert.equal(translationRetryDelay({ status: 429 }), 5500);
  assert.equal(translationRetryDelay({ status: 429 }, 2), 11000);
  assert.equal(translationRetryDelay({ status: 429 }, 30), 300000);
  assert.equal(translationRetryDelay({ status: 429, retryAfter: "999999999999" }), 86400000);
  assert.equal(translationRetryDelay({ status: 429, retryAfterSeconds: 0.01 }), 5500);
  assert.equal(translationRetryDelay({ status: 503, code: "rate_limit_unavailable", retryAfterSeconds: 30 }), 30000);
  for (const error of [null, {}, { status: 500 }, { status: 503 }, { status: 401 }]) assert.equal(translationRetryDelay(error), null);
});

// Execute the actual page effect, not a hand-written approximation. React's
// state/effect scheduling and browser timers are deterministic fixture ports;
// the queue, attempt ledger and retry parser are the production functions.
const source = readFileSync(new URL("../src/pages/CaddieAnalysisDetail.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {\n    if (autoRetryRef.current.scope");
const end = source.indexOf("\n  }, [isDemo, authUser?.id", start);
assert(start > 0 && end > start);
const effectSource = stripTypeScriptTypes(source.slice(start, end) + "\n  });", { mode: "strip" });
let sequence = 0;
function fixture(job: (target: string) => Promise<void> = async () => { throw limited(); }) {
  let effect: () => (() => void), cleanup: (() => void) | undefined, dirty = false, disposed = false, now = 1000, timerId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: string[] = [];
  const scope = {};
  const ctx: any = { ...language, ...queue, translationRetryDelay,
    isDemo: false, authUser: { id: "account-a" }, autoScope: scope, autoScopeRef: { current: scope }, autoRetryRef: { current: { scope, until: 0, failures: 0 } }, autoRequestRef: { current: null },
    autoId: `retry-fixture-${sequence++}`, autoSample: "Hold your finish.", autoLanguage: "en", locale: "ja",
    useEffect(fn: typeof effect) { effect = fn; }, setTranslating() {}, setAutoTick() { if (!disposed) dirty = true; },
    window: { setTimeout(fn: () => void, delay: number) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout(id: number) { timers.delete(id); } },
    Date: { now: () => now }, console: { error() {} },
    translateCaddieAnalysis: async (_id: string, target: string) => { calls.push(target); await job(target); ctx.autoLanguage = target; dirty = true; },
  };
  const render = () => { cleanup?.(); vm.runInNewContext(effectSource, ctx); cleanup = effect!(); };
  const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty && !disposed) { dirty = false; render(); } } };
  render();
  return { ctx, calls, timers, flush, render, now: () => now,
    async advance(ms: number) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); },
    switchScope(changes: Record<string, unknown>) { Object.assign(ctx, changes); ctx.autoScope = {}; ctx.autoScopeRef.current = ctx.autoScope; render(); },
    dispose() { disposed = true; cleanup?.(); },
  };
}
test("daily quota makes one request and one timer, no immediate tick; resumes only at deadline", async () => {
  const f = fixture(); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  await f.advance(86399999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 1); f.dispose();
});
test("minute quota survives ordinary rerenders without duplicate or early retries", async () => {
  const f = fixture(async () => { throw limited(60); }); await f.flush();
  await f.advance(10000); f.render(); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  await f.advance(49999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); f.dispose();
});
test("missing retry metadata backs off, and successful retry stops", async () => {
  let count = 0;
  const f = fixture(async () => { if (++count < 3) throw { status: 429 }; }); await f.flush();
  await f.advance(5500); assert.equal(f.calls.length, 2);
  await f.advance(10999); assert.equal(f.calls.length, 2);
  await f.advance(1); assert.equal(f.calls.length, 3); assert.equal(f.timers.size, 0);
  await f.advance(86400000); assert.equal(f.calls.length, 3); f.dispose();
});
test("ordinary failures do not retry", async () => {
  const f = fixture(async () => { throw { status: 502 }; }); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.render(); await f.flush(); assert.equal(f.calls.length, 1); f.dispose();
});
test("unmount cancels the retry timer", async () => {
  const f = fixture(); await f.flush(); f.dispose(); assert.equal(f.timers.size, 0);
  await f.advance(86400000); assert.equal(f.calls.length, 1);
});
test("language and analysis changes cancel the old wait and isolate the new scope", async () => {
  const f = fixture(); await f.flush();
  f.switchScope({ locale: "ko" }); await f.flush(); assert.deepEqual(f.calls, ["ja", "ko"]); assert.equal(f.timers.size, 1);
  f.switchScope({ autoId: `changed-${sequence++}` }); await f.flush(); assert.equal(f.calls.length, 3); assert.equal(f.timers.size, 1); f.dispose();
});
test("signout cancels timer and sends no retry", async () => {
  const f = fixture(); await f.flush(); f.switchScope({ authUser: null }); await f.flush();
  assert.equal(f.timers.size, 0); await f.advance(86400000); assert.equal(f.calls.length, 1); f.dispose();
});
test("late rejection after account switch cannot schedule or change new scope", async () => {
  let reject!: (error: unknown) => void;
  const f = fixture(() => new Promise((_resolve, no) => { reject = no; })); await f.flush();
  f.switchScope({ authUser: null }); reject(limited()); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.ctx.autoRetryRef.current.until, 0); f.dispose();
});
test("queued job is skipped if disposed before it starts", async () => {
  const f = fixture(); f.dispose(); await f.flush(); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});
test("same-scope rerender while pending still records cooldown and retains one timer", async () => {
  let reject!: (error: unknown) => void;
  const f = fixture(() => new Promise((_resolve, no) => { reject = no; })); await f.flush();
  f.render(); reject(limited(60)); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  await f.advance(59999); assert.equal(f.calls.length, 1); f.dispose();
});

test("fetch and relay contexts retain the original network error", async () => {
  for (const context of [new TypeError("fetch failed"), undefined, {}, "gateway error"]) {
    const error = await translationRequestError({ message: "Failed to send request", context });
    assert.equal(error.message, "Failed to send request");
    assert.equal(translationRetryDelay(error), null);
  }
});
