// .review-gate/ state: active task, per-task progress, verdicts, cost ledger,
// metadata-only audit log, and short-lived payload copies (auto-deleted after N days).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileAgeDays, localDay, localMonth, nowIso, readJsonSafe } from "./util.mjs";

export function stateDir(repoRoot) {
  return join(repoRoot, ".review-gate");
}

function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ---------- active task ----------
export function readActiveTask(repoRoot) {
  const r = readJsonSafe(join(stateDir(repoRoot), "active-task.json"));
  if (r.missing) return { task: null };
  if (r.error || !r.value?.task_id || !r.value?.spec?.scope) return { task: null, error: r.error ?? "active-task.json is invalid" };
  return { task: r.value };
}

export function writeActiveTask(repoRoot, task) {
  writeJson(join(ensure(stateDir(repoRoot)), "active-task.json"), task);
}

export function clearActiveTask(repoRoot) {
  rmSync(join(stateDir(repoRoot), "active-task.json"), { force: true });
}

// ---------- per-task progress (cycles, finding history, notifications) ----------
export function readProgress(repoRoot, taskId) {
  const r = readJsonSafe(join(stateDir(repoRoot), "tasks", `${taskId}.json`));
  return r.value ?? { task_id: taskId, revise_cycles: 0, last_state: null, findings: {}, notified: null };
}

export function writeProgress(repoRoot, progress) {
  writeJson(join(ensure(join(stateDir(repoRoot), "tasks")), `${progress.task_id}.json`), progress);
}

// ---------- verdicts (keyed by work hash) ----------
function verdictPath(repoRoot, workHash) {
  return join(stateDir(repoRoot), "verdicts", `${workHash.replace(/[^a-f0-9]/gi, "").slice(0, 64)}.json`);
}

export function saveVerdict(repoRoot, verdict) {
  ensure(join(stateDir(repoRoot), "verdicts"));
  writeJson(verdictPath(repoRoot, verdict.work_hash), verdict);
}

export function loadVerdict(repoRoot, workHash) {
  const r = readJsonSafe(verdictPath(repoRoot, workHash));
  if (!r.value) return null;
  // A verdict only counts for the exact hash and task it was issued for.
  if (r.value.work_hash !== workHash) return null;
  return r.value;
}

export function hasDone(repoRoot, task, workHash) {
  const v = loadVerdict(repoRoot, workHash);
  return !!v && v.task_id === task.task_id && v.state === "DONE";
}

// ---------- cost ledger (metadata only) ----------
export function appendLedger(repoRoot, entry) {
  ensure(stateDir(repoRoot));
  appendFileSync(join(stateDir(repoRoot), "ledger.jsonl"), JSON.stringify({ ts: nowIso(), day: localDay(), month: localMonth(), ...entry }) + "\n");
}

export function readLedger(repoRoot) {
  const p = join(stateDir(repoRoot), "ledger.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function usageTotals(repoRoot) {
  const day = localDay();
  const month = localMonth();
  const entries = readLedger(repoRoot);
  const today = entries.filter((e) => e.day === day);
  return {
    dayCalls: today.filter((e) => e.counted).length,
    dayUsd: today.reduce((s, e) => s + (Number(e.est_usd) || 0), 0),
    monthUsd: entries.filter((e) => e.month === month).reduce((s, e) => s + (Number(e.est_usd) || 0), 0),
    quotaExhausted: entries.some((e) => e.month === month && e.outcome === "quota_exhausted"),
  };
}

// ---------- audit log: metadata ONLY ----------
const AUDIT_FIELDS = ["event", "task_id", "work_hash", "cycle", "state", "risk", "finding_ids", "tool", "action_class", "tier", "decision", "reason", "in_tokens", "out_tokens", "est_usd", "outcome", "notes"];

export function audit(repoRoot, entry) {
  try {
    ensure(stateDir(repoRoot));
    const clean = { ts: nowIso(), hook_version: 1 };
    for (const k of AUDIT_FIELDS) if (entry[k] !== undefined) clean[k] = typeof entry[k] === "string" ? entry[k].slice(0, 300) : entry[k];
    appendFileSync(join(stateDir(repoRoot), "audit.jsonl"), JSON.stringify(clean) + "\n");
  } catch {
    // Auditing must never break a gate decision.
  }
}

// ---------- payload copies (short retention) ----------
export function savePayload(repoRoot, taskId, cycle, request) {
  const dir = ensure(join(stateDir(repoRoot), "payloads"));
  const name = `${taskId}-c${cycle}-${Date.now()}.json`;
  writeJson(join(dir, name), request);
  return name;
}

export function cleanupPayloads(repoRoot, retentionDays) {
  const dir = join(stateDir(repoRoot), "payloads");
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (fileAgeDays(join(dir, f)) > retentionDays) {
      rmSync(join(dir, f), { force: true });
      removed++;
    }
  }
  return removed;
}
