// Shared helpers for the GolfMe Review Gate (development tooling only).
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_REPO_MARKER = ".review-gate-test-repo";

// Glob -> RegExp. Supports **, *, ? (forward-slash paths).
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

export function toPosix(p) {
  return String(p ?? "").replace(/\\/g, "/");
}

// Repo-relative posix path, or null when outside the repo.
export function repoRelative(repoRoot, filePath) {
  const root = toPosix(resolve(repoRoot)).replace(/\/+$/, "");
  const abs = toPosix(resolve(repoRoot, filePath));
  if (abs.toLowerCase() === root.toLowerCase()) return "";
  if (abs.toLowerCase().startsWith(root.toLowerCase() + "/")) return abs.slice(root.length + 1);
  return null;
}

// Walks up from `start` to the directory containing `.git`. fs-only (no git spawn) to keep hooks fast.
export function findRepoRoot(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readJsonSafe(path) {
  try {
    if (!existsSync(path)) return { missing: true, value: null };
    return { value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: String(error?.message ?? error), value: null };
  }
}

// Test mode is honoured only when BOTH the env flag is set AND the repo carries
// the test marker file, which the gate forbids creating in a real repo. This keeps
// mocks, fault injection and policy overrides out of real sessions.
export function isTestMode(repoRoot) {
  return process.env.REVIEW_GATE_TEST_MODE === "1" && !!repoRoot && existsSync(join(repoRoot, TEST_REPO_MARKER));
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return extra ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base?.[k] && typeof base[k] === "object" ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadPolicy(repoRoot) {
  const policy = JSON.parse(readFileSync(join(TOOL_DIR, "policy.json"), "utf8"));
  if (isTestMode(repoRoot) && process.env.REVIEW_GATE_POLICY_OVERRIDE) {
    return deepMerge(policy, JSON.parse(process.env.REVIEW_GATE_POLICY_OVERRIDE));
  }
  return policy;
}

export function fileAgeDays(path) {
  try {
    return (Date.now() - statSync(path).mtimeMs) / 86_400_000;
  } catch {
    return 0;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localMonth(d = new Date()) {
  return localDay(d).slice(0, 7);
}
