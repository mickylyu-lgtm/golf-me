import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { caddieRequestSource } from "../supabase/functions/_shared/caddieRequestSource.ts";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const edge = read("supabase/functions/analyze-swing/index.ts");
const ast = ts.createSourceFile("index.ts", edge, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const serve = ast.statements.find((stmt): stmt is ts.ExpressionStatement =>
  ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
  stmt.expression.expression.getText(ast) === "Deno.serve"
);
assert.ok(serve && ts.isCallExpression(serve.expression));
const handlerSource = serve.expression.arguments[0].getText(ast);
const handlerJs = ts.transpileModule(`const handler = ${handlerSource};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ auth = true, status = "complete", source = "community_post", fresh = false } = {}) {
  const calls: string[] = [];
  const id = "c1bbb0a0-c481-4225-96d8-696840664eb5";
  const existing = {
    id, status, source_type: source, created_at: "2026-11-15T00:00:00Z",
    attempt: 1,
    attempt_started_at: fresh ? new Date().toISOString() : "2026-11-15T00:00:00Z",
    source_media_path: source === "direct_upload" ? "owner/clip.mp4" : null,
  };
  const env = {
    Deno: { env: { get: (key: string) => key === "CADDIE_DISABLED" ? "" : "fixture" } },
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: auth ? { id: "owner" } : null } }) },
      rpc: async (name: string) => { calls.push(name); return {}; },
      from: (table: string) => {
        calls.push(table);
        return { select: () => ({
          eq: (column: string, lookup: string) => {
            assert.equal(column, "id");
            assert.equal(lookup, id);
            return { maybeSingle: async () => ({ data: existing }) };
          },
        }) };
      },
    }),
    parseSampleRate: () => 0,
    caddieRequestSource,
    jsonResponse: (body: unknown, status: number) => Response.json(body, { status }),
    UUID_RE: /^[a-f0-9-]{36}$/,
    STALE_PROCESSING_MS: 6 * 60 * 1000,
    MAX_ATTEMPTS: 4,
    ownCaddiePath: (path: unknown) => { if (path !== undefined) { calls.push("private path"); assert.equal(path, "owner/clip.mp4"); } return null; },
  };
  const handler = new Function(...Object.keys(env), `${handlerJs}; return handler;`)(...Object.values(env)) as (req: Request) => Promise<Response>;
  return { calls, id, existing, run: (body: unknown) => handler(new Request("https://example.test", { method: "POST", body: JSON.stringify(body) })) };
}

test("the Edge handler rejects cached Community requests before database or provider work", async () => {
  const f = setup();
  for (const body of [
    { sourceType: "community_post", sourcePostId: f.id },
    { sourceType: "community_post" },
    { sourceType: "community_post", retryAnalysisId: 123 },
  ]) {
    const response = await f.run(body);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "community_source_disabled");
  }
  const invalid = await f.run(null);
  assert.equal(invalid.status, 400);
  assert.deepEqual(f.calls, []);
});

test("the Community cutoff does not change authentication or the direct-upload route", async () => {
  const unsigned = setup({ auth: false });
  assert.equal((await unsigned.run({ sourceType: "community_post" })).status, 401);
  assert.deepEqual(unsigned.calls, []);
  const signed = setup();
  const direct = await signed.run({ sourceType: "direct_upload", sourceMediaPath: "owner/clip.mp4" });
  assert.equal(direct.status, 400);
  assert.equal((await direct.json()).code, "cant_analyze", "normal private-media validation still applies");
  assert.deepEqual(signed.calls, ["sweep_stale_caddie_jobs", "private path"]);
});

test("completed and already-running Community rows remain accessible without a fresh attempt", async () => {
  for (const fixture of [{ status: "complete" }, { status: "processing", fresh: true }]) {
    const f = setup(fixture);
    const r = await f.run({ sourceType: "community_post", retryAnalysisId: f.id, sourcePostId: "ignored" });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).analysis, f.existing);
    assert.deepEqual(f.calls, ["sweep_stale_caddie_jobs", "caddie_analyses"]);
  }
});

test("failed or stale Community rows reject new attempts, using the stored source", async () => {
  for (const status of ["failed", "processing"]) {
    const f = setup({ status });
    const r = await f.run({ sourceType: "direct_upload", retryAnalysisId: f.id });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, "community_source_disabled");
    assert.deepEqual(f.calls, ["sweep_stale_caddie_jobs", "caddie_analyses"]);
  }
  const bad = setup();
  assert.equal((await bad.run({ sourceType: "community_post", retryAnalysisId: "" })).status, 400);
  assert.deepEqual(bad.calls, ["sweep_stale_caddie_jobs"], "no fallback to new work");
});

test("a direct-upload retry reaches existing private-media validation unchanged", async () => {
  const f = setup({ status: "failed", source: "direct_upload" });
  const r = await f.run({ sourceType: "community_post", retryAnalysisId: f.id });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "cant_analyze", "fixture's private media is unavailable");
  assert.deepEqual(f.calls, ["sweep_stale_caddie_jobs", "caddie_analyses", "private path"]);
});

test("Home, Community and post details use the same card without embedded Caddie controls", () => {
  const card = read("src/components/community/PostCard.tsx");
  for (const page of ["Home", "Community", "PostDetail"]) assert.match(read(`src/pages/${page}.tsx`), /<PostCard/);
  assert.doesNotMatch(card, /askCaddie|viewAnalysis|SwingAnalysisPanel|createCaddieAnalysis|retryCaddieAnalysis|caddieAnalyses/);
  assert.match(card, /<video[\s>]/);
  assert.match(card, /<FullscreenMediaViewer/);
  assert.match(card, /<PostShareButton/);
  assert.match(card, /togglePostUpvote\(post.id\)/);
  assert.match(card, /commentsForPost\(post.id\)/);
  assert.match(read("src/pages/AnalyzeSwing.tsx"), /sourceType: "direct_upload"/);
  const detail = read("src/pages/CaddieAnalysisDetail.tsx");
  assert.match(detail, /retryCaddieAnalysis\(analysis\)/);
  assert.match(detail, /const canRetryAnalysis = failure.canRetry && !fromCommunity/);
  assert.match(detail, /fromCommunity = analysis.sourceType === "community_post"/);
});
