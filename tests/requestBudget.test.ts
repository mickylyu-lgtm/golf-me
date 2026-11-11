import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { consumeRequestBudget, budgetResponse, type BudgetClient } from "../supabase/functions/_shared/requestBudget.ts";
import chatVideo, { consumeRequestBudget as nodeBudget } from "../api/chat-video.ts";
import { handleRequest } from "../supabase/functions/course-photos/handler.ts";

function client(data: unknown, error: unknown = null): BudgetClient {
  return { rpc(name, args) {
    assert.equal(name, "consume_request_budget");
    assert.deepEqual(args, { p_action: "chat-video" }, "caller cannot select user, threshold or time");
    return { async abortSignal(signal) {
      assert.ok(signal instanceof AbortSignal);
      return { data, error };
    } };
  } };
}

for (const [label, consume] of [["Edge", consumeRequestBudget], ["Node", nodeBudget]] as const) {
  test(label + " limiter admits only an explicit valid central-budget response", async () => {
    assert.deepEqual(await consume(client({ allowed: true, retry_after_seconds: 0 }), "chat-video"), { allowed: true });
    assert.deepEqual(await consume(client({ allowed: false, retry_after_seconds: 37 }), "chat-video"),
      { allowed: false, status: 429, code: "rate_limited", retryAfter: 37 });
  });
  test(label + " limiter fails closed on missing schema, transport and malformed responses", async () => {
    for (const data of [null, {}, true, [], { allowed: true }, { allowed: "true" },
      { allowed: true, retry_after_seconds: 1 }, { allowed: false, retry_after_seconds: 0 },
      { allowed: false, retry_after_seconds: -1 }, { allowed: false, retry_after_seconds: 86401 },
      { allowed: false, retry_after_seconds: 2.5 }, { allowed: false, retry_after_seconds: "2" }]) {
      const result = await consume(client(data), "chat-video");
      assert.equal(result.allowed, false);
      if (!result.allowed) assert.equal(result.status, 503);
    }
    assert.equal((await consume(client({ allowed: true, retry_after_seconds: 0 }, { code: "PGRST202" }), "chat-video")).allowed, false);
    const broken = { rpc() { throw new Error("secret-containing network detail"); } } as BudgetClient;
    assert.deepEqual(await consume(broken, "chat-video"),
      { allowed: false, status: 503, code: "rate_limit_unavailable", retryAfter: 30 });
  });
}

test("rate rejection carries readable Retry-After/CORS and no-store without private details", async () => {
  const response = budgetResponse({ allowed: false, status: 429, code: "rate_limited", retryAfter: 42 },
    { "Access-Control-Allow-Origin": "*" })!;
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "42");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), "Retry-After");
  assert.deepEqual(await response.json(), {
    error: "Too many requests. Please try again later.", code: "rate_limited", retryAfterSeconds: 42,
  });
  assert.equal(budgetResponse({ allowed: true }, {}), null);
});

test("course photos returns the limiter result before database/provider work", async () => {
  let work = 0;
  const res = await handleRequest(new Request("https://fixture.invalid", { method: "POST", body: "{}" }), {
    authenticate: async () => budgetResponse({ allowed: false, status: 429, code: "rate_limited", retryAfter: 20 }, {})!,
    store: new Proxy({}, { get() { work++; throw Error("should not run"); } }),
  } as any);
  assert.equal(res.status, 429);
  assert.equal(work, 0);
});

// Actual Edge handlers, with only the platform and client wiring replaced.
async function edgeHandler(action: string, fakeClient: unknown) {
  const root = new URL("../supabase/functions/", import.meta.url);
  const source = readFileSync(new URL(action + "/index.ts", root), "utf8")
    .replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', "")
    .replace('import { createClient } from "npm:@supabase/supabase-js@2";',
      "const createClient = () => globalThis.__budgetFixtureClient;")
    .replace(/from "(\.\.\/_shared\/[^"]+)"/g, (_match, ref) =>
      "from " + JSON.stringify(new URL(ref, new URL(action + "/index.ts", root)).href));
  let handler: (req: Request) => Promise<Response>;
  const g = globalThis as any;
  const oldDeno = g.Deno, oldClient = g.__budgetFixtureClient;
  g.__budgetFixtureClient = fakeClient;
  g.Deno = { env: { get: () => "fixture" }, serve(h: typeof handler) { handler = h; } };
  try {
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
    await import("data:text/javascript;base64," + Buffer.from(compiled + "\n// " + Math.random()).toString("base64"));
    return { handler: handler!, restore() { g.Deno = oldDeno; g.__budgetFixtureClient = oldClient; } };
  } catch (e) { g.Deno = oldDeno; g.__budgetFixtureClient = oldClient; throw e; }
}

test("course search rejects public/anonymous identity before place, nearby and search provider work", async () => {
  const oldFetch = globalThis.fetch;
  let providers = 0, budgets = 0;
  globalThis.fetch = (async () => { providers++; throw Error("must not reach provider"); }) as typeof fetch;
  try {
    for (const user of [null, { id: "test", is_anonymous: true }]) {
      const f = await edgeHandler("course-search", {
        auth: { getUser: async () => ({ data: { user }, error: null }) },
        rpc() { budgets++; throw Error("must not consume unauthenticated budget"); },
      });
      try {
        for (const body of [{ mode: "place", query: "New York" }, { mode: "nearby", lat: 40, lng: -73 }, { mode: "search", query: "Bethpage" }]) {
          assert.equal((await f.handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) }))).status, 401);
        }
      } finally { f.restore(); }
    }
    assert.equal(providers, 0); assert.equal(budgets, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("course search and enrichment stop before providers on rate rejection or outage", async () => {
  const oldFetch = globalThis.fetch;
  let providers = 0;
  globalThis.fetch = (async () => { providers++; throw Error("must not reach provider"); }) as typeof fetch;
  try {
    for (const action of ["course-search", "course-enrich"]) for (const outage of [false, true]) {
      const fake = {
        auth: { getUser: async () => ({ data: { user: { id: "fixture", is_anonymous: false } }, error: null }) },
        rpc(name: string, args: unknown) {
          assert.equal(name, "consume_request_budget"); assert.deepEqual(args, { p_action: action });
          return { abortSignal: async () => ({ data: outage ? null : { allowed: false, retry_after_seconds: 59 }, error: outage ? {} : null }) };
        },
        from() { return { select() { return this; }, eq() { return this; },
          maybeSingle: async () => ({ data: { id: "fixture", name: "Fixture", golfcourseapi_checked_at: null }, error: null }) }; },
      };
      const f = await edgeHandler(action, fake);
      try {
        const body = action === "course-search" ? { mode: "place", query: "New York" } : { courseId: "fixture" };
        const response = await f.handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) }));
        assert.equal(response.status, outage ? 503 : 429);
        assert.equal(response.headers.get("Retry-After"), outage ? "30" : "59");
      } finally { f.restore(); }
    }
    assert.equal(providers, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("chat-video emitted server artifact boots without importing src or Edge files", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "chat-budget-package-"));
  try {
    mkdirSync(path.join(dir, "api"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"), "dir");
    const source = readFileSync(new URL("../api/chat-video.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
    const output = path.join(dir, "api/chat-video.js");
    writeFileSync(output, compiled);
    const mod = await import(pathToFileURL(output).href);
    let status = 0;
    const res = { status(value: number) { status = value; return this; }, json() {} };
    await mod.default({ method: "GET" }, res);
    assert.equal(status, 405);
    assert.deepEqual(await mod.consumeRequestBudget(client({ allowed: false, retry_after_seconds: 30 }), "chat-video"),
      { allowed: false, status: 429, code: "rate_limited", retryAfter: 30 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("translation throttles before Gemini and same-language cached answers do not spend a budget", async () => {
  const oldFetch = globalThis.fetch;
  let providers = 0;
  globalThis.fetch = (async () => { providers++; throw Error("must not reach Gemini"); }) as typeof fetch;
  try {
    for (const same of [false, true]) {
      let budgets = 0;
      const fake = {
        auth: { getUser: async () => ({ data: { user: { id: "fixture", is_anonymous: false } }, error: null }) },
        rpc() { budgets++; return { abortSignal: async () => ({ data: { allowed: false, retry_after_seconds: 41 }, error: null }) }; },
        from() { return { select() { return this; }, eq() { return this; },
          single: async () => ({ data: { id: "fixture", status: "complete", analysis_json: {
            language: same ? "en" : "es", summary: "Keep your finish balanced.", strengths: [], work_on: [], limitations: [],
            focus: { title: "Balance", instruction: "Hold your finish." },
            drill: { name: "Finish hold", steps: ["Hold your finish."] },
            score: Object.fromEntries(["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"]
              .map((key) => [key, { points: 12, reason: "You hold your balance." }])),
          } }, error: null }) }; },
      };
      const f = await edgeHandler("translate-caddie-analysis", fake);
      try {
        const response = await f.handler(new Request("https://fixture.invalid", {
          method: "POST", body: JSON.stringify({ analysisId: "fixture", locale: "en" }),
        }));
        assert.equal(response.status, same ? 200 : 429);
        assert.equal(budgets, same ? 0 : 1);
      } finally { f.restore(); }
    }
    assert.equal(providers, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("chat-video authenticates then stops a limited request before any Storage or ffmpeg work", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  const userId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  const calls: string[] = [];
  process.env.SUPABASE_URL = "https://budget-fixture.supabase.co";
  process.env.SUPABASE_ANON_KEY = "fixture";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: userId, is_anonymous: false }),
      { headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/rest/v1/rpc/consume_request_budget")) return new Response(JSON.stringify({ allowed: false, retry_after_seconds: 24 }),
      { headers: { "Content-Type": "application/json" } });
    throw Error("unexpected storage/provider call");
  }) as typeof fetch;
  try {
    let status = 0, answer: unknown;
    const headers: Record<string, unknown> = {};
    const res = {
      setHeader(name: string, value: unknown) { headers[name] = value; },
      status(value: number) { status = value; return this; },
      json(body: unknown) { answer = body; },
    };
    await chatVideo({ method: "POST", headers: { authorization: "Bearer fixture-token" },
      body: { scope: "dm", scopeId: userId, messageId, index: 0, stagedPath: userId + "/" + messageId + "-0.orig" } } as any, res as any);
    assert.equal(status, 429);
    assert.equal(headers["Retry-After"], "24");
    assert.deepEqual(answer, { error: "rate_limited", retryAfterSeconds: 24 });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});


test("course search never returns provider URL secrets in transport or upstream errors", async () => {
  const oldFetch = globalThis.fetch;
  const fake = {
    auth: { getUser: async () => ({ data: { user: { id: "fixture", is_anonymous: false } }, error: null }) },
    rpc() { return { abortSignal: async () => ({ data: { allowed: true, retry_after_seconds: 0 }, error: null }) }; },
  };
  try {
    for (const transportError of [false, true]) {
      globalThis.fetch = (async () => {
        if (transportError) throw Error("https://provider.invalid?apiKey=DO_NOT_EXPOSE");
        return new Response("request failed: apiKey=DO_NOT_EXPOSE", { status: 500 });
      }) as typeof fetch;
      const f = await edgeHandler("course-search", fake);
      try {
        const response = await f.handler(new Request("https://fixture.invalid", {
          method: "POST", body: JSON.stringify({ mode: "place", query: "New York" }),
        }));
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /DO_NOT_EXPOSE|apiKey|provider\.invalid/);
      } finally { f.restore(); }
    }
  } finally { globalThis.fetch = oldFetch; }
});


test("chat-video typechecks with Vercel non-strict discriminator settings", () => {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--ignoreConfig", "--noEmit",
    "--skipLibCheck", "--target", "es2023", "--module", "nodenext", "--allowImportingTsExtensions",
    "--strict", "false", "api/chat-video.ts"], { stdio: "pipe" });
});
