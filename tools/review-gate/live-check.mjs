#!/usr/bin/env node
// GolfMe Review Gate — live reviewer check (P0). Sends HARMLESS SYNTHETIC code
// (a tiny clampPercent helper, never real GolfMe code) through the exact
// production path: sanitizer -> budget checks -> real transport -> strict
// validation -> ledger. Human-gated by the PreToolUse hook because it spends
// money.
//   node tools/review-gate/live-check.mjs [--case secret,done,revise]
// Cases:
//   secret  a fake API key in the diff; must be blocked BEFORE anything is sent
//   done    a correct change; the reviewer should return DONE (or CONTINUE)
//   revise  a change with an obvious bug; the reviewer should return REVISE
// Prints metadata only. Never prints the API key.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { callReviewer } from "./lib/reviewer.mjs";
import { sanitizeWork } from "./lib/sanitize.mjs";
import { PROTOCOL } from "./lib/schema.mjs";
import { appendLedger, audit, usageTotals } from "./lib/state.mjs";
import { selectTransport } from "./lib/transport.mjs";
import { findRepoRoot, loadPolicy } from "./lib/util.mjs";

const FILE = "src/lib/clampPercent.ts";
const HEADER = ["/** Clamps a percentage to the inclusive range 0..100. NaN becomes 0. */", "export function clampPercent(n: number): number {", "  if (Number.isNaN(n)) return 0;"];
const CASES = {
  secret: {
    expect: ["NOT_SENT"],
    // Built at runtime so this file never contains a key-shaped literal.
    code: [...HEADER, "  return Math.min(100, Math.max(0, n));", "}", `export const reviewerKey = "${"sk-" + "proj-" + "Q".repeat(32)}";`],
  },
  done: { expect: ["DONE", "CONTINUE"], code: [...HEADER, "  return Math.min(100, Math.max(0, n));", "}"] },
  revise: { expect: ["REVISE"], code: [...HEADER, "  return Math.max(100, Math.min(0, n));", "}"] },
};

export function syntheticDiff(lines) {
  return [`diff --git a/${FILE} b/${FILE}`, "new file mode 100644", "--- /dev/null", `+++ b/${FILE}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`), ""].join("\n");
}

function estimateUsd(pricing, inT, outT) {
  if (pricing.inputPerMillion == null || pricing.outputPerMillion == null) return null;
  return (inT * pricing.inputPerMillion + outT * pricing.outputPerMillion) / 1_000_000;
}

export async function runLiveCase(repoRoot, name, { sleep } = {}) {
  const c = CASES[name];
  if (!c) return { case: name, ok: false, reason: "unknown case" };
  const policy = loadPolicy(repoRoot);
  const L = policy.limits;
  const diff = syntheticDiff(c.code);
  const clean = sanitizeWork({ diff }, L);
  if (clean.blocked) {
    audit(repoRoot, { event: "live_check", task_id: "LIVE-CHECK", reason: `blocked before send: ${clean.blockReasons.join(" | ")}` });
    return { case: name, expected: c.expect, state: "NOT_SENT", sent: false, reason: clean.blockReasons.join(" | "), ok: c.expect.includes("NOT_SENT") };
  }
  if (!policy.realCallsEnabled || !policy.model) return { case: name, ok: false, sent: false, reason: "real calls are disabled in policy.json" };
  const request = {
    protocol: PROTOCOL,
    task_id: `LIVE-CHECK-${name}`,
    work_hash: "sha256:" + createHash("sha256").update(diff).digest("hex"),
    cycle: 1,
    objective: "Add a pure helper clampPercent(n) that clamps a number to the inclusive range 0..100 and returns 0 for NaN. Synthetic reviewer self-test; not real GolfMe code.",
    requirements: ["clampPercent(-5) === 0", "clampPercent(50) === 50", "clampPercent(150) === 100", "clampPercent(NaN) === 0", "No other files change."],
    approved_scope: [FILE],
    hard_constraints: ["No new dependencies.", "No changes outside the approved scope."],
    risk_declared: "low",
    files_changed: [{ path: FILE, status: "added", additions: c.code.length, deletions: 0 }],
    diff: clean.diff,
    file_contents: [],
    tests: [{ command: "npx tsc -b", result: "pass", summary: "typecheck clean (synthetic)" }],
    architecture_decisions: [],
    risks: [],
    rollback: "Delete the file.",
    open_questions: [],
    previous_findings: [],
    redaction_report: { redacted_count: 0, excluded_paths: clean.excluded },
  };
  // Same budget rules as review.mjs, checked before any call.
  const usage = usageTotals(repoRoot);
  if (usage.quotaExhausted || usage.monthUsd >= L.monthlyCapUsd) return { case: name, ok: false, sent: false, reason: "monthly reviewer budget reached" };
  if (usage.dayCalls >= L.maxCallsPerDay) return { case: name, ok: false, sent: false, reason: `daily reviewer call limit (${L.maxCallsPerDay}) reached` };
  const worst = estimateUsd(policy.pricing, Math.ceil(JSON.stringify(request).length / 3), L.maxOutputTokens);
  if (worst == null) return { case: name, ok: false, sent: false, reason: "model pricing not configured; refusing to spend" };
  if (usage.dayUsd + worst > L.dailySoftStopUsd) return { case: name, ok: false, sent: false, reason: `daily soft stop ($${L.dailySoftStopUsd}) would be exceeded` };

  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  const t0 = Date.now();
  const result = await callReviewer(request, {
    transport: selectTransport(repoRoot, policy),
    limits: L,
    sleep,
    deadline: Date.now() + L.totalReviewTimeoutMs,
    onAttempt: (a) => {
      const inT = a.usage?.input_tokens ?? 0;
      const outT = a.usage?.output_tokens ?? 0;
      tokensIn += inT;
      tokensOut += outT;
      if (a.counted) calls++;
      appendLedger(repoRoot, { task_id: "LIVE-CHECK", cycle: 1, model: policy.model, http: a.status ?? null, in_tokens: inT, out_tokens: outT, est_usd: estimateUsd(policy.pricing, inT, outT) ?? 0, outcome: a.outcome, counted: !!a.counted });
    },
  });
  const out = {
    case: name,
    expected: c.expect,
    sent: calls > 0,
    outcome: result.outcome,
    attempts: result.attempts.map((a) => `${a.outcome}${a.status ? `:${a.status}` : ""}`),
    ms: Date.now() - t0,
    tokens: { in: tokensIn, out: tokensOut },
    est_usd: Number((estimateUsd(policy.pricing, tokensIn, tokensOut) ?? 0).toFixed(4)),
  };
  if (result.outcome !== "ok") return { ...out, state: result.outcome === "unavailable" ? "UNAVAILABLE" : "BLOCKED", reason: result.reason, ok: false };
  const v = result.validation.value;
  audit(repoRoot, { event: "live_check", task_id: request.task_id, state: v.state, finding_ids: v.findings.map((f) => f.id) });
  return {
    ...out,
    schema_valid: true,
    state: v.state,
    original_state: result.validation.originalState,
    risk: v.risk,
    findings: v.findings.map((f) => `${f.id} ${f.severity}/${f.category} ${f.file}:${f.line}`),
    notes: result.validation.notes,
    authority_claim: result.validation.authorityClaim,
    summary: v.summary,
    ok: c.expect.includes(v.state),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--case");
  const arg = process.argv.find((a) => a.startsWith("--case="))?.slice(7) ?? (i > 1 ? process.argv[i + 1] : undefined);
  const names = (arg ?? "secret,done,revise").split(",").filter(Boolean);
  const repoRoot = findRepoRoot(process.cwd());
  const results = [];
  for (const n of names) results.push(await runLiveCase(repoRoot, n.trim()));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
