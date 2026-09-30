#!/usr/bin/env node
// GolfMe Review Gate: run one review of the active task.
//   node tools/review-gate/review.mjs [--json] [--dry-run]
// Exposes runReview() for the Stop hook. Never throws; always returns a state.
import { pathToFileURL } from "node:url";
import { changedFiles, computeWorkHash, specHash, taskDiff } from "./lib/hash.mjs";
import { callReviewer } from "./lib/reviewer.mjs";
import { fitPayload, sanitizeWork } from "./lib/sanitize.mjs";
import { PROTOCOL } from "./lib/schema.mjs";
import {
  appendLedger,
  audit,
  cleanupPayloads,
  loadVerdict,
  readActiveTask,
  readProgress,
  saveVerdict,
  savePayload,
  usageTotals,
  writeProgress,
} from "./lib/state.mjs";
import { selectTransport } from "./lib/transport.mjs";
import { findRepoRoot, loadPolicy, nowIso } from "./lib/util.mjs";

function estimateUsd(pricing, inTokens, outTokens) {
  if (pricing.inputPerMillion == null || pricing.outputPerMillion == null) return null;
  return (inTokens * pricing.inputPerMillion + outTokens * pricing.outputPerMillion) / 1_000_000;
}

function outcomeState(outcome) {
  if (outcome === "quota_exhausted" || outcome === "config_error" || outcome === "malformed") return "BLOCKED";
  return "UNAVAILABLE"; // internal: never DONE, never recorded as a verdict
}

export async function runReview({ repoRoot, dryRun = false, sleep } = {}) {
  repoRoot = repoRoot ?? findRepoRoot(process.cwd());
  const policy = loadPolicy(repoRoot);
  const L = policy.limits;
  cleanupPayloads(repoRoot, L.payloadRetentionDays);

  const { task, error } = readActiveTask(repoRoot);
  if (error) return { state: "BLOCKED", reason: `active task state unreadable: ${error}` };
  if (!task) return { state: "NONE", reason: "no active review task" };

  const progress = readProgress(repoRoot, task.task_id);
  const base = { task_id: task.task_id };

  let workHash;
  try {
    if (specHash(task.spec) !== task.spec_sha256) return { ...base, state: "USER_APPROVAL_REQUIRED", reason: "task spec/scope changed since the task started; start a new review task" };
    workHash = computeWorkHash(repoRoot, task);
  } catch (e) {
    return { ...base, state: "BLOCKED", reason: `could not hash work: ${e.message}` };
  }

  const existing = loadVerdict(repoRoot, workHash);
  if (existing && existing.task_id === task.task_id) return { ...base, work_hash: workHash, state: existing.state, reason: "cached verdict for this exact work hash", findings: existing.findings ?? [], cached: true };

  // Cycle / disagreement limits.
  if (progress.revise_cycles >= L.maxReviseCycles) {
    audit(repoRoot, { event: "limit_hit", task_id: task.task_id, work_hash: workHash, reason: "revise cycles exhausted" });
    return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: `reviewer and builder did not converge in ${L.maxReviseCycles} REVISE cycles` };
  }
  const stuck = Object.entries(progress.findings).find(([, h]) => (h.disputed ?? 0) >= L.maxDisputesPerFinding || (h.reopened ?? 0) >= 1);
  if (stuck) return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: `repeated disagreement on finding ${stuck[0]}` };

  // Budget / call limits (checked before any call).
  const usage = usageTotals(repoRoot);
  if (usage.quotaExhausted || usage.monthUsd >= L.monthlyCapUsd) return { ...base, work_hash: workHash, state: "BLOCKED", reason: "monthly reviewer budget reached" };
  if (usage.dayCalls >= L.maxCallsPerDay) return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: `daily reviewer call limit (${L.maxCallsPerDay}) reached` };

  // Build + sanitize payload.
  let diff;
  let files;
  try {
    diff = taskDiff(repoRoot, task);
    files = changedFiles(repoRoot, task);
  } catch (e) {
    return { ...base, work_hash: workHash, state: "BLOCKED", reason: `could not read task diff: ${e.message}` };
  }
  const clean = sanitizeWork({ diff, fileContents: task.file_contents ?? [] }, L, { publishedContactEmailSha256: policy.publishedContactEmailSha256 ?? [] });
  if (clean.blocked) {
    audit(repoRoot, { event: "sanitizer_block", task_id: task.task_id, work_hash: workHash, reason: clean.blockReasons.join(" | ") });
    return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: `payload not sent: ${clean.blockReasons.join(" | ")}`, sanitizer: clean };
  }
  const cycle = progress.revise_cycles + 1;
  const spec = task.spec;
  let request = {
    protocol: PROTOCOL,
    task_id: task.task_id,
    work_hash: workHash,
    cycle,
    objective: spec.objective,
    requirements: spec.requirements ?? [],
    approved_scope: spec.scope,
    hard_constraints: spec.hard_constraints ?? [],
    risk_declared: spec.risk ?? "medium",
    files_changed: files.filter((f) => !clean.excluded.includes(f.path)),
    diff: clean.diff,
    file_contents: clean.file_contents,
    tests: task.tests ?? [],
    architecture_decisions: spec.architecture_decisions ?? [],
    risks: spec.risks ?? [],
    rollback: spec.rollback ?? "",
    open_questions: spec.open_questions ?? [],
    previous_findings: Object.entries(progress.findings).map(([id, h]) => ({ id, status: h.status ?? "open", note: (h.note ?? "").slice(0, 500) })),
    redaction_report: { redacted_count: clean.publishedContactRedactions, excluded_paths: clean.excluded },
  };
  const fit = fitPayload(request, L.maxPayloadChars);
  if (!fit.fitted) return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: "payload exceeds the hard size limit even after trimming; split the task" };
  request = fit.request;

  // Worst-case cost pre-check (real calls only; mock fixtures supply their own usage).
  const worstIn = Math.ceil(JSON.stringify(request).length / 3);
  const worstUsd = estimateUsd(policy.pricing, worstIn, L.maxOutputTokens);
  const isMock = !!process.env.REVIEW_GATE_MOCK;
  if (!isMock && worstUsd == null && policy.realCallsEnabled) return { ...base, work_hash: workHash, state: "BLOCKED", reason: "model pricing not configured; refusing to spend" };
  if (worstUsd != null && usage.dayUsd + worstUsd > L.dailySoftStopUsd) return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: `daily soft stop ($${L.dailySoftStopUsd}) would be exceeded` };

  if (dryRun) return { ...base, work_hash: workHash, state: "DRY_RUN", request };

  const payloadFile = savePayload(repoRoot, task.task_id, cycle, request);
  audit(repoRoot, { event: "review_request", task_id: task.task_id, work_hash: workHash, cycle });

  const transport = selectTransport(repoRoot, policy);
  let dayCallsSoFar = usage.dayCalls;
  const result = await callReviewer(request, {
    transport,
    limits: L,
    sleep,
    deadline: Date.now() + L.totalReviewTimeoutMs,
    onAttempt: (a) => {
      const inT = a.usage?.input_tokens ?? 0;
      const outT = a.usage?.output_tokens ?? 0;
      const usd = estimateUsd(policy.pricing, inT, outT) ?? 0;
      if (a.counted) dayCallsSoFar++;
      appendLedger(repoRoot, { task_id: task.task_id, cycle, model: policy.model, http: a.status ?? null, in_tokens: inT, out_tokens: outT, est_usd: usd, day_calls: dayCallsSoFar, outcome: a.outcome, counted: !!a.counted });
    },
  });

  if (result.outcome !== "ok") {
    const state = outcomeState(result.outcome);
    audit(repoRoot, { event: "review_result", task_id: task.task_id, work_hash: workHash, cycle, state, outcome: result.outcome, reason: result.reason });
    progress.last_state = state;
    writeProgress(repoRoot, progress);
    return { ...base, work_hash: workHash, state, reason: result.reason, payloadFile, errors: result.validation?.errors };
  }

  const v = result.validation.value;
  // Finding history for disagreement detection.
  for (const f of v.findings) {
    const h = progress.findings[f.id] ?? { status: "open", seen: 0 };
    if (h.status === "addressed" && h.seen > 0) h.reopened = (h.reopened ?? 0) + 1;
    h.seen++;
    h.severity = f.severity;
    if (h.status !== "disputed") h.status = "open";
    progress.findings[f.id] = h;
  }
  if (v.state === "REVISE") progress.revise_cycles += 1;
  progress.last_state = v.state;
  writeProgress(repoRoot, progress);

  const verdict = {
    task_id: task.task_id,
    work_hash: workHash,
    state: v.state,
    original_state: result.validation.originalState,
    risk: v.risk,
    findings: v.findings,
    notes: result.validation.notes,
    authority_claim: result.validation.authorityClaim,
    decided_at: nowIso(),
  };
  saveVerdict(repoRoot, verdict);
  audit(repoRoot, {
    event: "review_result",
    task_id: task.task_id,
    work_hash: workHash,
    cycle,
    state: v.state,
    risk: v.risk,
    finding_ids: v.findings.map((f) => f.id),
    notes: result.validation.notes.join(" | ").slice(0, 300),
  });

  if (v.state === "REVISE" && progress.revise_cycles > L.maxReviseCycles) {
    return { ...base, work_hash: workHash, state: "USER_APPROVAL_REQUIRED", reason: "REVISE cycle limit exceeded", findings: v.findings };
  }
  return { ...base, work_hash: workHash, state: v.state, reason: v.summary, findings: v.findings, notes: result.validation.notes, authorityClaim: result.validation.authorityClaim, payloadFile };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const r = await runReview({ dryRun: process.argv.includes("--dry-run") });
  const out = { ...r };
  if (out.request) out.request = { ...out.request, diff: `[${out.request.diff.length} chars]` };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
