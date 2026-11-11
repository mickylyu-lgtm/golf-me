import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { cleanCaddieFeedback, cleanCaddieFeedbackText, hasCompleteCaddieFeedback, CADDIE_FEEDBACK_CONTENT_RULE } from "../supabase/functions/_shared/caddieFeedbackText.ts";
import { sanitizeCheckpointCues, sanitizeWorkOnCheckpoint, withSanitizedCheckpointCues } from "../supabase/functions/_shared/caddieCues.ts";
import { withMeasuredCueCheck, phasesFromJson } from "../supabase/functions/_shared/caddieVerdicts.ts";

const tail = "Constraints遵守。 Analysis completed successfully.";
const keys = ["setup_and_posture", "backswing", "downswing_sequencing", "balance_and_weight_transfer", "finish"];
function fixture(language = "en") {
  return {
    language, summary: "Keep your finish balanced.", camera_angle: "face_on",
    strengths: ["You hold your finish."],
    work_on: [{ issue: "Keep your weight forward.", why_it_matters: "It supports balance.", confidence: "high", checkpoint: "follow_through" }],
    focus: { title: "Balance", instruction: "Hold your finish." },
    drill: { name: "Finish hold", steps: ["Hold for 3 seconds."] },
    limitations: ["The camera cannot establish clubface angle."],
    phases: { follow_through: { timestamp_seconds: 3.5, confidence: "high" } },
    score: Object.fromEntries(keys.map((key) => [key, { points: 12, reason: "You hold your balance." }])),
    checkpoint_cues: { follow_through: "Hold your finish." },
  };
}

test("screenshot regression: remove both mixed-language status sentences, preserve Chinese coaching", () => {
  const text = "收杆时重心保持在前脚，但身体略有晃动。" + tail;
  assert.equal(cleanCaddieFeedbackText(text), "收杆时重心保持在前脚，但身体略有晃动。");
  assert.equal(cleanCaddieFeedbackText(tail), "");
  assert.equal(cleanCaddieFeedbackText("Analysis completed successfully..."), "");
});

test("known status boilerplate is removed independently of the selected language", () => {
  for (const suffix of [
    tail, "All constraints have been satisfied. Analysis completed successfully.",
    "已遵守所有约束。分析已成功完成。", "所有約束已滿足。分析已完成。",
    "Restricciones cumplidas. Análisis completado con éxito.",
    "制約を遵守しました。分析が正常に完了しました。",
    "제약 조건을 준수했습니다. 분석이 성공적으로 완료되었습니다.",
  ]) {
    for (const language of ["en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
      const input = fixture(language);
      input.score.finish.reason += " " + suffix;
      assert.equal(cleanCaddieFeedback(input).score.finish.reason, "You hold your balance.", language + suffix);
    }
  }
});

test("coaching, limitations, decimals, English golf terms and related words remain byte-for-byte", () => {
  for (const text of [
    "The analysis is limited by camera angle. Your finish looks balanced.",
    "Practice within your physical constraints. Hold the finish for 3.5 seconds.",
    "Your follow-through is completed successfully when you remain balanced.",
    "Keep your finish balanced. Constraints are important when choosing a drill.",
    "练习 driver 时保持平衡。不要强迫身体超出舒适范围。",
    "請用 7-iron 練習，保持 3 秒。", "ドライバーで balance を保つ練習です。",
    "Constraints were met by slowing the backswing.", "Your analysis completed successfully, but balance still needs work.",
  ]) assert.equal(cleanCaddieFeedbackText(text), text);
});

test("all prose fields are cleaned without mutation or changing facts and extension metadata", () => {
  const source = fixture("zh-CN");
  source.summary += " " + tail;
  source.strengths[0] += " " + tail;
  source.work_on[0].issue += " " + tail;
  source.work_on[0].why_it_matters += " " + tail;
  source.focus.title += ". " + tail;
  source.focus.instruction += " " + tail;
  source.drill.name += ". " + tail;
  source.drill.steps[0] += " " + tail;
  source.limitations[0] += " " + tail;
  source.checkpoint_cues.follow_through += " " + tail;
  for (const key of keys) source.score[key].reason += " " + tail;
  const input = { ...source, metadata: tail, media: "https://fixture.invalid/video.mp4" };
  const before = structuredClone(input);
  const cleaned = cleanCaddieFeedback(input);
  assert.deepEqual(input, before);
  assert.deepEqual(cleaned.phases, before.phases);
  assert.deepEqual(cleaned.work_on.map((w) => [w.confidence, w.checkpoint]), before.work_on.map((w) => [w.confidence, w.checkpoint]));
  assert.equal(cleaned.metadata, tail);
  assert.equal(cleaned.media, before.media);
  for (const key of keys) assert.equal(cleaned.score[key].points, 12);
  assert.equal(cleaned.language, "zh-CN");
  assert.equal(cleaned.summary, "Keep your finish balanced.");
  assert.equal(cleaned.focus.title, "Balance.");
  assert.equal(cleaned.checkpoint_cues.follow_through, "Hold your finish.");
  assert.equal(hasCompleteCaddieFeedback(cleaned), true);
  assert.deepEqual(cleanCaddieFeedback(cleaned), cleaned, "idempotent");
});

test("future output rejects missing or metadata-only required explanations, not fabricated coaching", () => {
  assert.equal(hasCompleteCaddieFeedback(cleanCaddieFeedback(fixture())), true);
  const bad = fixture();
  bad.score.finish.reason = tail;
  assert.equal(hasCompleteCaddieFeedback(cleanCaddieFeedback(bad)), false);
  for (const value of [null, [], {}, { summary: "Okay" }]) assert.equal(hasCompleteCaddieFeedback(value), false);
});

// Execute the real production mapping functions, not a hand-written copy.
// Network, React, storage and private customer data are not involved.
test("old stored rows and translated responses are cleaned at the shared UI mapping boundary", () => {
  const source = fs.readFileSync("src/context/RealCaddieContext.tsx", "utf8");
  const start = source.indexOf("const SCORE_CRITERION_KEYS:");
  const end = source.indexOf("export interface CreateAnalysisInput");
  assert.ok(start > 0 && end > start);
  const exports = vm.runInNewContext(ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText + "\n({ rowToAnalysis });", {
    cleanCaddieFeedback, cleanCaddieFeedbackText, sanitizeWorkOnCheckpoint, phasesFromJson,
    analysisLanguageFromJson: (v: unknown) => v,
    checkpointCuesFromJson: sanitizeCheckpointCues,
  });
  const json = fixture("zh-CN");
  json.score.finish.reason = "保持收杆平衡。" + tail;
  const stored = { id: "synthetic", analysis_summary: "保持收杆平衡。" + tail,
    strengths: ["保持平衡。" + tail], issues: [tail], recommendations: [], drills: [],
    analysis_json: json, score: 60 };
  const before = JSON.stringify(stored);
  for (const language of [undefined, "en", "zh-CN", "zh-TW", "es", "ko", "ja"]) {
    const mapped = exports.rowToAnalysis({ ...stored, analysis_json: { ...json, language } }, undefined, new Map());
    assert.equal(mapped.details.score.criteria.finish.reason, "保持收杆平衡。");
    assert.equal(mapped.details.score.criteria.finish.points, 12);
    assert.equal(mapped.details.score.total, 60);
    assert.equal(mapped.analysisSummary, "保持收杆平衡。");
    assert.equal(mapped.issues.length, 0);
  }
  const legacy = exports.rowToAnalysis({ ...stored, analysis_json: null }, undefined, new Map());
  assert.equal(legacy.analysisSummary, "保持收杆平衡。");
  assert.equal(JSON.stringify(stored), before, "render cleanup never mutates stored data");
});

async function translate(source: ReturnType<typeof fixture>, output: unknown, locale = "zh-CN") {
  let handler: (request: Request) => Promise<Response>;
  const writes: any[] = [];
  let budgetCalls = 0;
  const requests: any[] = [];
  let pending: unknown;
  const row = { id: "synthetic", status: "complete", analysis_json: source, updated_at: "2020-01-01" };
  const query: any = {
    select: () => query, eq: () => query,
    update: (body: unknown) => { pending = body; writes.push(body); return query; },
    single: async () => ({ data: pending ? { ...row, ...(pending as object) } : row }),
  };
  const input = fs.readFileSync("supabase/functions/translate-caddie-analysis/index.ts", "utf8").replace(/^import .+;\r?$/gm, "");
  vm.runInNewContext(ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    Deno: { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "synthetic" } } }) }, from: () => query }),
    cleanCaddieFeedback, hasCompleteCaddieFeedback, CADDIE_FEEDBACK_CONTENT_RULE,
    sanitizeCheckpointCues, sanitizeWorkOnCheckpoint, withSanitizedCheckpointCues, withMeasuredCueCheck,
    consumeRequestBudget: async () => { budgetCalls++; return {}; }, budgetResponse: () => null,
    providerErrorHint: () => "", redactDetail: () => "", safeErrorName: () => "Error",
    Response, console: { log() {}, error() {} },
    fetch: async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
    },
  });
  const response = await handler!(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ analysisId: "synthetic", locale }) }));
  return { response, writes, requests, budgetCalls };
}

test("translation cleans its input and output and preserves score/timestamps/confidence", async () => {
  const source = fixture();
  source.score.finish.reason += " " + tail;
  const output = fixture("zh-CN");
  output.score.finish.reason = "保持收杆平衡。" + tail;
  const result = await translate(source, output);
  assert.equal(result.response.status, 200);
  assert.equal(result.writes.length, 1);
  assert.doesNotMatch(JSON.stringify(result.requests[0].contents), /Constraints|completed successfully/);
  assert.equal(result.writes[0].analysis_json.score.finish.reason, "保持收杆平衡。");
  assert.deepEqual(JSON.parse(JSON.stringify(result.writes[0].analysis_json.phases)), source.phases);
  assert.equal(result.writes[0].analysis_json.score.finish.points, 12);
  assert.equal(result.writes[0].analysis_json.work_on[0].confidence, "high");
});

test("partial translations cannot silently retain English reasons under a Chinese locale", async () => {
  for (const mutate of [
    (f: any) => { delete f.score.finish; },
    (f: any) => { f.score.finish.reason = tail; },
    (f: any) => { f.work_on = []; },
    (f: any) => { f.drill.steps = []; },
  ]) {
    const output = fixture("zh-CN");
    mutate(output);
    const result = await translate(fixture(), output);
    assert.equal(result.response.status, 502);
    assert.equal(result.writes.length, 0);
  }
});

test("same-locale no-op spends no provider call, malformed source cannot invent missing coaching", async () => {
  const same = await translate(fixture("zh-CN"), null);
  assert.equal(same.response.status, 200);
  assert.equal(same.requests.length, 0);
  assert.equal(same.writes.length, 0);
  const source = fixture();
  source.score.finish.reason = tail;
  const bad = await translate(source, fixture("zh-CN"));
  assert.equal(bad.response.status, 502);
  assert.equal(bad.requests.length, 0);
  assert.equal(bad.budgetCalls, 0);
  assert.equal(bad.writes.length, 0);
});

test("generation sanitizes and validates inside the existing retry boundary before persistence", () => {
  const source = fs.readFileSync("supabase/functions/analyze-swing/index.ts", "utf8");
  const parse = source.indexOf("candidateJson = cleanCaddieFeedback(JSON.parse(text))");
  const valid = source.indexOf("!hasCompleteCaddieFeedback(candidateJson)", parse);
  const accept = source.indexOf("return candidateJson", valid);
  const save = source.indexOf("analysis_summary: parsed.summary", accept);
  assert.ok(parse > 0 && valid > parse && accept > valid && save > accept);
  assert.match(source, /Rules:\s*- \$\{CADDIE_FEEDBACK_CONTENT_RULE\}/);
});

test("optional boilerplate-only list entries do not block a legitimate translation", async () => {
  const source = fixture();
  source.limitations = [tail];
  source.strengths = [tail, "You hold your finish."];
  source.drill.steps = [tail, "Hold for 3 seconds."];
  const output = fixture("zh-CN");
  output.limitations = [];
  const result = await translate(source, output);
  assert.equal(result.response.status, 200);
  assert.equal(result.writes.length, 1);
  const cleaned = cleanCaddieFeedback(source);
  assert.deepEqual(cleaned.limitations, []);
  assert.deepEqual(cleaned.strengths, ["You hold your finish."]);
  assert.deepEqual(cleaned.drill.steps, ["Hold for 3 seconds."]);
  assert.equal(hasCompleteCaddieFeedback(cleaned), true);
  const invalid = fixture();
  invalid.limitations = [""];
  assert.equal(hasCompleteCaddieFeedback(cleanCaddieFeedback(invalid)), false, "originally empty entries are not laundered");
  invalid.limitations = [];
  invalid.drill.steps = [tail];
  assert.equal(hasCompleteCaddieFeedback(cleanCaddieFeedback(invalid)), false, "a drill still needs a real step");
});

test("translation preserves unknown stored score metadata and extra criterion attributes", async () => {
  const source = fixture();
  (source.score as any).metadata = { version: 1, reason: tail };
  (source.score.finish as any).evidence = { frame: 5 };
  const result = await translate(source, fixture("zh-CN"));
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.writes[0].analysis_json.score.metadata)), { version: 1, reason: tail });
  assert.deepEqual(JSON.parse(JSON.stringify(result.writes[0].analysis_json.score.finish.evidence)), { frame: 5 });
});
