#!/usr/bin/env node
// GolfMe Review Gate — PreToolUse hook. Outputs "deny" or "ask", or nothing.
// Never outputs "allow". Kept dependency-free and tiny: if anything below fails
// (bad input, a broken lib, a crash), the inline FAST_GATES still deny the most
// dangerous actions before exiting, so a crash can never silently wave them through.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAST_GATES = [
  /\bgit\s+push\b/,
  /\bvercel\b/,
  /\bsupabase\s+(functions|secrets|db|migration|storage|link|login|projects|branches)\b/,
  /\bmigrate-caddie-media-private\b.*--apply/,
  /\b(filter-repo|filter-branch|update-ref\s+-d|reflog\s+expire)\b/,
  /\b(xcodebuild|xcrun|fastlane|altool)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b/,
  /REVIEW_GATE|\.review-gate|review-gate-test-repo/,
  /\.env(?!\.example)|\.claude[\\/]channels|\.golfme-review|\.p8\b|\.pem\b/,
  /"tool_name"\s*:\s*"mcp__plugin_supabase_supabase__(apply_migration|deploy_edge_function|execute_sql|create_branch|delete_branch|merge_branch|reset_branch|rebase_branch|create_project|pause_project|restore_project)"/,
  /DirectMessageThread|BottomNav|[Kk]eyboard|capacitor\.config|[\\/]ios[\\/]|\.claude[\\/]settings|tools[\\/]review-gate/,
];

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
}

let raw = "";
try {
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const libDir = process.env.REVIEW_GATE_TEST_MODE === "1" && process.env.REVIEW_GATE_LIB_DIR ? process.env.REVIEW_GATE_LIB_DIR : join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
  const { decide } = await import(pathToFileURL(join(libDir, "decide.mjs")).href);
  const d = await decide(input);
  if (d) emit(d.decision, d.reason);
  process.exit(0);
} catch (err) {
  if (FAST_GATES.some((re) => re.test(raw))) {
    try {
      emit("deny", `GolfMe Review Gate: hook error (${String(err?.message ?? err).slice(0, 120)}); gated action refused (fail-closed).`);
      process.exit(0);
    } catch {
      process.exit(2); // Claude Code treats exit 2 from PreToolUse as a block.
    }
  }
  process.exit(0); // harmless call: never block normal work because the gate broke
}
