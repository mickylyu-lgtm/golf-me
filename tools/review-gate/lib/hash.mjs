// Work hash: binds a reviewer verdict to the exact task spec + the exact content
// of every file in the task scope. Any edit, new file, deletion, spec or scope
// change produces a new hash, so an old verdict can never cover changed work.
// Content-based (not diff-vs-HEAD) so committing reviewed work does not
// invalidate its own verdict before the push.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function specHash(spec) {
  return sha256(canonicalJson(spec));
}

function git(repoRoot, args, opts = {}) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

export function pathspecs(scope) {
  return scope.map((g) => `:(glob)${g}`);
}

export function listScopedFiles(repoRoot, scope) {
  const out = git(repoRoot, ["ls-files", "-co", "--exclude-standard", "-z", "--", ...pathspecs(scope)]);
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

export function computeWorkHash(repoRoot, task) {
  const files = listScopedFiles(repoRoot, task.spec.scope).map((path) => {
    const abs = join(repoRoot, path);
    // Deleted-but-tracked files show up in ls-files -c; record them as deleted.
    if (!existsSync(abs)) return { path, sha256: "deleted" };
    return { path, sha256: sha256(readFileSync(abs).toString("utf8").replace(/\r\n/g, "\n")) };
  });
  const material = { v: 1, task_id: task.task_id, spec_sha256: specHash(task.spec), files };
  return "sha256:" + sha256(canonicalJson(material));
}

// Unified diff of the whole task (since the task's base commit) + untracked
// scoped files rendered as additions. Media/binaries are detected later by the sanitizer.
export function taskDiff(repoRoot, task) {
  let diff = git(repoRoot, ["diff", "--no-color", "--no-ext-diff", task.base_commit, "--", ...pathspecs(task.spec.scope)]);
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs(task.spec.scope)])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of untracked) {
    const buf = readFileSync(join(repoRoot, path));
    const binary = buf.includes(0);
    const body = binary ? "Binary files /dev/null and b/" + path + " differ\n" : buf.toString("utf8").replace(/\r\n/g, "\n").split("\n").map((l) => "+" + l).join("\n") + "\n";
    diff += `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${body}`;
  }
  return diff;
}

export function changedFiles(repoRoot, task) {
  const out = git(repoRoot, ["diff", "--numstat", task.base_commit, "--", ...pathspecs(task.spec.scope)]);
  const files = out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, d, path] = l.split("\t");
      return { path, status: "M", additions: Number(a) || 0, deletions: Number(d) || 0 };
    });
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs(task.spec.scope)]).split("\0").filter(Boolean);
  for (const path of untracked) files.push({ path, status: "A", additions: 0, deletions: 0 });
  return files;
}

export function headCommit(repoRoot) {
  return git(repoRoot, ["rev-parse", "HEAD"]).trim();
}
