// Reviewer transports.
//  - mockTransport: plays scripted HTTP-like responses from a fixture file. Only
//    usable in test mode (env flag + test-repo marker), never in a real session.
//  - openaiTransport (lib/openai.mjs): the real OpenAI Responses API call. Used
//    only when policy.json enables real calls AND names a model; review.mjs also
//    refuses to spend while pricing is unknown.
//  - disabledTransport: everything else. The reviewer is UNAVAILABLE, never DONE.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TransportError } from "./errors.mjs";
import { makeOpenAITransport } from "./openai.mjs";
import { isTestMode } from "./util.mjs";
import { stateDir } from "./state.mjs";

export { TransportError };

function fill(value, vars) {
  if (typeof value === "string") return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

export function makeMockTransport(repoRoot, fixturePath) {
  if (!isTestMode(repoRoot)) throw new TransportError("disabled", "mock reviewer is only available in test mode");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const cursorPath = join(stateDir(repoRoot), "mock-cursor.json");
  return async function mockTransport(request, { timeoutMs }) {
    const cursor = existsSync(cursorPath) ? JSON.parse(readFileSync(cursorPath, "utf8")).n : 0;
    writeFileSync(cursorPath, JSON.stringify({ n: cursor + 1 }));
    const step = fixture.responses[Math.min(cursor, fixture.responses.length - 1)];
    if (step.crash) throw new TransportError("crash", "reviewer process crashed (simulated)");
    if (step.network) throw new TransportError("network", "network error (simulated)");
    if ((step.delayMs ?? 0) >= timeoutMs) throw new TransportError("timeout", "request timed out (simulated)");
    const vars = { task_id: request.task_id, work_hash: request.work_hash };
    const body = step.bodyRaw !== undefined ? fill(step.bodyRaw, vars) : JSON.stringify(fill(step.body, vars));
    return { status: step.status ?? 200, headers: step.headers ?? {}, bodyText: body, usage: step.usage ?? { input_tokens: 0, output_tokens: 0 } };
  };
}

export async function disabledTransport() {
  throw new TransportError("disabled", "real OpenAI calls are disabled (policy.json realCallsEnabled/model not set)");
}

export function selectTransport(repoRoot, policy) {
  const mock = process.env.REVIEW_GATE_MOCK;
  if (mock && isTestMode(repoRoot)) return makeMockTransport(repoRoot, mock);
  if (!policy.realCallsEnabled || !policy.model) return disabledTransport;
  return makeOpenAITransport(repoRoot, policy);
}
