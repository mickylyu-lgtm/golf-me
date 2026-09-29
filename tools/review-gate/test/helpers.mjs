// Test helpers: throwaway git repos in the OS temp dir, marked as test repos.
// Nothing here touches the real GolfMe repo, the network, or any real secret.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PRETOOL = join(TOOL, "hooks", "pretool.mjs");
export const STOP = join(TOOL, "hooks", "stop.mjs");

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

export function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rg-test-"));
  git(dir, "init", "-q");
  const base = {
    ".review-gate-test-repo": "test marker\n",
    ".gitignore": ".review-gate/\n",
    "src/app.ts": "export const a = 1;\n",
    "src/lib/util.ts": "export const u = 1;\n",
    "src/pages/DirectMessageThread.tsx": "export {};\n",
    "src/components/layout/BottomNav.tsx": "export {};\n",
    "docs/readme.md": "hello\n",
    ...files,
  };
  for (const [p, c] of Object.entries(base)) writeFile(dir, p, c);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export function writeFile(dir, path, content) {
  const abs = join(dir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

export function commitAll(dir, msg = "c") {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

export function setTestEnv(extra = {}) {
  process.env.REVIEW_GATE_TEST_MODE = "1";
  delete process.env.REVIEW_GATE_MOCK;
  delete process.env.REVIEW_GATE_POLICY_OVERRIDE;
  delete process.env.REVIEW_GATE_TEST_FAULT;
  delete process.env.REVIEW_GATE_LIB_DIR;
  delete process.env.REVIEW_GATE_TEST_OPENAI_URL;
  delete process.env.REVIEW_GATE_TEST_OPENAI_KEY;
  delete process.env.REVIEW_GATE;
  Object.assign(process.env, extra);
}

export function spec(overrides = {}) {
  return {
    objective: "Test objective",
    scope: ["src/app.ts", "src/lib/**", "docs/**"],
    requirements: ["keep it simple"],
    hard_constraints: ["no production changes"],
    risk: "low",
    rollback: "git revert",
    ...overrides,
  };
}

export function reviewBody(state, extra = {}) {
  return {
    protocol: "golfme-review/1",
    task_id: "{{task_id}}",
    work_hash: "{{work_hash}}",
    state,
    risk: "low",
    findings: [],
    scope_change_detected: false,
    human_gate_reasons: [],
    summary: `mock ${state}`,
    ...extra,
  };
}

export function finding(id, severity = "major", extra = {}) {
  return { id, severity, category: "correctness", file: "src/app.ts", line: 1, issue: "issue text", required_change: "change text", ...extra };
}

// Fixtures live outside the test repo so they never show up in the task diff.
export function mockFixture(responses) {
  const path = join(mkdtempSync(join(tmpdir(), "rg-fix-")), "fixture.json");
  writeFileSync(path, JSON.stringify({ responses }));
  return path;
}

export function ok(body, usage = { input_tokens: 1000, output_tokens: 200 }) {
  return { status: 200, body, usage };
}

export function runHook(script, input, env = {}) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, REVIEW_GATE_TEST_MODE: "1", ...env },
    timeout: 60_000,
  });
  let out = null;
  try {
    out = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    out = { unparsable: r.stdout };
  }
  return { code: r.status, out, stderr: r.stderr };
}

export function pre(dir, tool_name, tool_input, env) {
  return runHook(PRETOOL, { hook_event_name: "PreToolUse", cwd: dir, tool_name, tool_input }, env);
}

export function decisionOf(res) {
  return res.out?.hookSpecificOutput?.permissionDecision ?? (res.code === 2 ? "deny" : "none");
}

export const noSleep = async () => {};
