#!/usr/bin/env node
// GolfMe Review Gate task CLI.
//   node tools/review-gate/task.mjs start --spec-json '<json>'  (human-gated: the prompt shows objective + scope)
//   node tools/review-gate/task.mjs start --spec <file.json>
//   node tools/review-gate/task.mjs status
//   node tools/review-gate/task.mjs note <F#> <addressed|disputed|open> "<note>"
//   node tools/review-gate/task.mjs tests <file.json>        (record test results for the payload)
//   node tools/review-gate/task.mjs done                     (reviewer-gated: needs DONE for current hash)
//   node tools/review-gate/task.mjs cancel                   (human-gated by the PreToolUse hook)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { computeWorkHash, headCommit, specHash } from "./lib/hash.mjs";
import { audit, clearActiveTask, hasDone, loadVerdict, readActiveTask, readProgress, writeActiveTask, writeProgress } from "./lib/state.mjs";
import { findRepoRoot, localDay, nowIso } from "./lib/util.mjs";

const RISKS = ["low", "medium", "high", "critical"];

export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["spec must be an object"];
  if (typeof spec.objective !== "string" || !spec.objective.trim() || spec.objective.length > 1000) errors.push("objective: required string ≤1000");
  if (!Array.isArray(spec.scope) || spec.scope.length === 0 || !spec.scope.every((s) => typeof s === "string" && s.length <= 200)) errors.push("scope: non-empty array of path globs");
  if (spec.scope?.some((s) => s === "**" || s === "*" || s === "/" || s.startsWith("..") || s.startsWith("/"))) errors.push("scope: must not be the whole repo or outside it");
  if (spec.risk && !RISKS.includes(spec.risk)) errors.push("risk: low|medium|high|critical");
  for (const k of ["requirements", "hard_constraints", "architecture_decisions", "risks", "open_questions", "expected_human_gates"]) {
    if (spec[k] !== undefined && (!Array.isArray(spec[k]) || !spec[k].every((x) => typeof x === "string"))) errors.push(`${k}: array of strings`);
  }
  return errors;
}

export function startTask(repoRoot, spec) {
  const existing = readActiveTask(repoRoot);
  if (existing.task) return { ok: false, error: `task ${existing.task.task_id} is already active` };
  const errors = validateSpec(spec);
  if (errors.length) return { ok: false, error: errors.join("; ") };
  const day = localDay().replace(/-/g, "");
  const task_id = `T-${day}-${String(Date.now()).slice(-5)}`;
  const task = { task_id, spec, spec_sha256: specHash(spec), base_commit: headCommit(repoRoot), started_at: nowIso() };
  writeActiveTask(repoRoot, task);
  writeProgress(repoRoot, { task_id, revise_cycles: 0, last_state: null, findings: {}, notified: null });
  audit(repoRoot, { event: "task_start", task_id });
  return { ok: true, task };
}

export function taskStatus(repoRoot) {
  const { task, error } = readActiveTask(repoRoot);
  if (error) return { ok: false, error };
  if (!task) return { ok: true, active: false };
  const hash = computeWorkHash(repoRoot, task);
  const verdict = loadVerdict(repoRoot, hash);
  return { ok: true, active: true, task_id: task.task_id, scope: task.spec.scope, work_hash: hash, verdict: verdict?.state ?? null, progress: readProgress(repoRoot, task.task_id) };
}

export function noteFinding(repoRoot, id, status, note) {
  const { task } = readActiveTask(repoRoot);
  if (!task) return { ok: false, error: "no active task" };
  if (!/^F\d{1,3}$/.test(id) || !["addressed", "disputed", "open"].includes(status)) return { ok: false, error: "usage: note F# addressed|disputed|open <note>" };
  const p = readProgress(repoRoot, task.task_id);
  const h = p.findings[id] ?? { status: "open", seen: 0 };
  h.status = status;
  h.note = String(note ?? "").slice(0, 500);
  if (status === "disputed") h.disputed = (h.disputed ?? 0) + 1;
  p.findings[id] = h;
  writeProgress(repoRoot, p);
  return { ok: true };
}

export function recordTests(repoRoot, tests) {
  const { task } = readActiveTask(repoRoot);
  if (!task) return { ok: false, error: "no active task" };
  if (!Array.isArray(tests)) return { ok: false, error: "tests must be an array" };
  task.tests = tests.slice(0, 30).map((t) => ({ command: String(t.command).slice(0, 200), result: ["pass", "fail", "skipped"].includes(t.result) ? t.result : "fail", summary: String(t.summary ?? "").slice(0, 500) }));
  writeActiveTask(repoRoot, task);
  return { ok: true };
}

export function finishTask(repoRoot) {
  const { task } = readActiveTask(repoRoot);
  if (!task) return { ok: false, error: "no active task" };
  const hash = computeWorkHash(repoRoot, task);
  if (!hasDone(repoRoot, task, hash)) return { ok: false, error: `no DONE verdict for the current work hash ${hash.slice(0, 19)}…; re-review required` };
  clearActiveTask(repoRoot);
  audit(repoRoot, { event: "task_done", task_id: task.task_id, work_hash: hash });
  return { ok: true, task_id: task.task_id };
}

export function cancelTask(repoRoot) {
  const { task } = readActiveTask(repoRoot);
  if (!task) return { ok: false, error: "no active task" };
  clearActiveTask(repoRoot);
  audit(repoRoot, { event: "task_cancel", task_id: task.task_id });
  return { ok: true, task_id: task.task_id };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repoRoot = findRepoRoot(process.cwd());
  const [cmd, ...rest] = process.argv.slice(2);
  let r;
  try {
    if (cmd === "start") {
      // --spec-json '<json>' keeps the objective and scope visible in the approval prompt.
      const j = rest.indexOf("--spec-json");
      const i = rest.indexOf("--spec");
      if (j >= 0) r = startTask(repoRoot, JSON.parse(rest[j + 1]));
      else if (i >= 0) r = startTask(repoRoot, JSON.parse(readFileSync(rest[i + 1], "utf8")));
      else r = { ok: false, error: "usage: start --spec-json '<json>' | start --spec <file>" };
    } else if (cmd === "status") r = taskStatus(repoRoot);
    else if (cmd === "note") r = noteFinding(repoRoot, rest[0], rest[1], rest.slice(2).join(" "));
    else if (cmd === "tests") r = recordTests(repoRoot, JSON.parse(readFileSync(rest[0], "utf8")));
    else if (cmd === "done") r = finishTask(repoRoot);
    else if (cmd === "cancel") r = cancelTask(repoRoot);
    else r = { ok: false, error: "usage: start --spec-json '<json>' | start --spec <file> | status | note | tests <file> | done | cancel" };
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}
