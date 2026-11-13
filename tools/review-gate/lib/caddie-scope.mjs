// Approved local-only Caddie review scope, 2026-11-13.
// Authorization, signing, service execution, deployments and credentials stay gated.
import { lstatSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute } from "node:path";
export const CADDIE_ROOT = "/home/shmick/projects/caddie-review";
export function caddieEditAllowed(tool, input, root = CADDIE_ROOT) {
  if (!["Edit", "Write"].includes(tool) || typeof input?.file_path !== "string" || !isAbsolute(input.file_path)) return false;
  // Reject traversal before normalization: symlink/../ resolution differs in the OS.
  if (input.file_path.split("/").some(part => part === "." || part === "..")) return false;
  const file = resolve(input.file_path);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) return false;
  // Only ordinary source/UI files. All role, signing, API and ownership boundaries excluded.
  const ordinary = /^(docs\/[A-Za-z0-9_./-]+\.md|test\/[A-Za-z0-9_./-]+\.(ts|js|json)|src\/web\/static\/[A-Za-z0-9_./-]+\.(css|html|js))$/.test(rel);
  if (!ordinary || rel.split("/").some(x => x.startsWith(".")) || /(^|\/)(AGENTS|CLAUDE)\.md$/.test(rel)) return false;
  try {
    if (realpathSync(root) !== root) return false;
    let current = root;
    for (const part of rel.split("/")) {
      current = join(current, part);
      try {
        const s = lstatSync(current);
        if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) return false;
      } catch (e) { if (e.code !== "ENOENT") return false; }
    }
    return true;
  } catch { return false; }
}
