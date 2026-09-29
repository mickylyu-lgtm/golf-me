// PreToolUse decision: classify the call, add task/hash requirements, audit.
// Returns null (stay silent -> normal auto mode) | { decision: "ask"|"deny", reason }.
// NEVER returns "allow".
import { classifyToolCall, NEEDS_DONE_CLASSES } from "./classify.mjs";
import { computeWorkHash, specHash } from "./hash.mjs";
import { audit, hasDone, readActiveTask } from "./state.mjs";
import { findRepoRoot, isTestMode, loadPolicy } from "./util.mjs";

export async function decide(input) {
  const repoRoot = findRepoRoot(input.cwd || process.cwd());
  if (!repoRoot) return null;
  if (isTestMode(repoRoot) && process.env.REVIEW_GATE_TEST_FAULT === "crash-decide") throw new Error("simulated decide crash");

  const policy = loadPolicy(repoRoot);
  const { task, error: taskError } = readActiveTask(repoRoot);
  const ctx = { policy, repoRoot, activeTask: task };
  const c = classifyToolCall(input.tool_name ?? "", input.tool_input ?? {}, ctx);
  const tag = task ? `[${task.task_id}] ` : "";

  const log = (decision, extra = {}) => audit(repoRoot, { event: decision === "deny" ? "gate_deny" : "gate_ask", task_id: task?.task_id, tool: input.tool_name, action_class: c.cls, tier: c.tier, decision, reason: c.reason, ...extra });

  if (c.tier === "prohibited") {
    log("deny");
    return { decision: "deny", reason: `GolfMe Review Gate: prohibited — ${c.reason}` };
  }

  // Task state unreadable: cannot know whether reviewer/DONE requirements apply -> fail closed for gated
  // work. Commits count as gated here: otherwise corrupting the task file would bypass reviewer gating.
  if (taskError && (c.tier === "human" || c.tier === "reviewer" || c.cls === "git-commit")) {
    log("deny", { reason: `review task state unreadable: ${taskError}` });
    return { decision: "deny", reason: "GolfMe Review Gate: review-task state is unreadable, so gated actions are refused until it is fixed or the task is cancelled." };
  }

  const needsDone = c.tier === "reviewer" || (c.tier === "human" && task && NEEDS_DONE_CLASSES.has(c.cls));
  let workHash = null;
  if (needsDone && task) {
    try {
      if (specHash(task.spec) !== task.spec_sha256) throw new Error("task spec/scope changed after start");
      workHash = computeWorkHash(repoRoot, task);
    } catch (e) {
      log("deny", { reason: `cannot verify work hash: ${e.message}` });
      return { decision: "deny", reason: `GolfMe Review Gate: cannot verify the reviewed work (${e.message}); re-review required.` };
    }
    if (!hasDone(repoRoot, task, workHash)) {
      log("deny", { work_hash: workHash, reason: "no DONE verdict for current work hash" });
      return { decision: "deny", reason: `GolfMe Review Gate: ${tag}${c.reason} needs reviewer state DONE for the current work (${workHash.slice(0, 19)}…). The work changed since review or was never reviewed; re-review required.` };
    }
  }

  if (c.tier === "human") {
    log("ask", { work_hash: workHash ?? undefined });
    return { decision: "ask", reason: `GolfMe Review Gate: ${tag}human approval required — ${c.reason}${workHash ? ` (reviewed hash ${workHash.slice(7, 19)})` : ""}` };
  }
  return null; // auto, or reviewer-gated with DONE present
}
