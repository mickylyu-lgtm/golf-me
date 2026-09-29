// Permission classifier: maps one Claude Code tool call to a tier.
//   auto        -> hook stays silent (normal auto mode applies)
//   reviewer    -> needs a DONE verdict for the current work hash (inside a review task)
//   human       -> hook returns "ask" (Claude Code's own permission prompt, relayed to Telegram)
//   prohibited  -> hook returns "deny"
// The classifier never produces "allow": the gate can only add restrictions.
import { matchesAny, repoRelative, toPosix } from "./util.mjs";

export const TIER_RANK = { auto: 0, reviewer: 1, human: 2, prohibited: 3 };

function result(tier, cls, reason) {
  return { tier, cls, reason };
}

const GENERIC_CLASSES = new Set(["read-or-local", "unknown-command", "unknown-deferred"]);

// Higher tier wins; on a tie the more specific classification wins over a generic one.
export function worst(a, b) {
  if (TIER_RANK[b.tier] > TIER_RANK[a.tier]) return b;
  if (TIER_RANK[b.tier] === TIER_RANK[a.tier] && GENERIC_CLASSES.has(a.cls) && !GENERIC_CLASSES.has(b.cls)) return b;
  return a;
}

// Human-gated classes that, inside an active review task, ALSO need a DONE
// verdict for the current hash before the human prompt is even shown.
export const NEEDS_DONE_CLASSES = new Set([
  "git-push",
  "deploy",
  "supabase-cli",
  "supabase-migration",
  "supabase-edge-deploy",
  "supabase-sql-write",
  "supabase-admin",
  "storage-change",
  "ios-release",
]);

// ---------- SQL ----------
export function isReadOnlySql(sql) {
  if (typeof sql !== "string") return false;
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 1) return false;
  const s = statements[0];
  if (!/^(select|with|explain)\b/i.test(s)) return false;
  if (/^explain\s+analyze\b/i.test(s)) return false;
  if (
    /\b(insert|update|delete|merge|upsert|alter|create|drop|truncate|grant|revoke|comment|copy|call|do|vacuum|reindex|cluster|refresh|lock|set|reset|begin|commit|rollback|savepoint|listen|notify|prepare|execute|security)\b/i.test(
      s,
    )
  )
    return false;
  if (/(vault\.|pg_read|pg_write|lo_import|lo_export|dblink|pg_terminate|pg_cancel|set_config|nextval|setval|net\.http|pg_sleep|query_to_xml)/i.test(s))
    return false;
  return true;
}

// ---------- Shell commands ----------
const WRITE_VERBS =
  /(^|\s)(rm|del|rmdir|mv|cp|tee|touch|truncate|sed\s+-i|perl\s+-pi|Remove-Item|ri|Move-Item|mi|Copy-Item|cpi|Set-Content|sc|Add-Content|ac|Out-File|New-Item|ni|Rename-Item|rni|Clear-Content)\b|>{1,2}/i;

const GATE_READONLY =
  /^(cat|type|less|more|head|tail|ls|dir|grep|rg|wc|git\s+(status|diff|log|show)|Get-Content|gc|Get-ChildItem|gci|Select-String|Test-Path|node\s+(--test\s+tools\/review-gate\/test\S*|tools\/review-gate\/(review|task)\.mjs(\s+(status|--json|--dry-run))*))\b/i;

// The live reviewer self-test spends real API budget: always human-gated, exact form only.
const LIVE_CHECK = /^node\s+tools\/review-gate\/live-check\.mjs(\s+--case(=|\s+)[a-z,]+)?\s*$/;

// Segment rules, first match wins.
const PROHIBITED_SEGMENT = [
  [/^git\s+push\b.*(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/, "force-push", "force push / history rewrite is prohibited"],
  [/^git\s+(filter-repo|filter-branch)\b/, "history-rewrite", "history rewrite is prohibited"],
  [/^git\s+update-ref\s+-d\b/, "history-rewrite", "deleting refs is prohibited"],
  [/^git\s+reflog\s+expire\b/, "history-rewrite", "expiring reflog is prohibited"],
  [/^git\s+reset\s+--hard\s+(origin|upstream)\//, "history-rewrite", "hard reset to a remote ref is prohibited"],
];

const HUMAN_SEGMENT = [
  [/^git\s+push\b/, "git-push", "git push"],
  [/^git\s+(rebase|clean\s+-[a-z]*f|commit\b.*--amend|checkout\s+--\s|restore\b|stash\s+(drop|clear)|branch\s+-[dD]\b|tag\s+-d|reset\s+--hard)/, "git-destructive", "destructive local git operation"],
  [/^gh\s+(pr\s+merge|release|repo\s+(delete|edit|rename)|secret|variable|workflow\s+run|api\b)/, "github-write", "GitHub write operation"],
  [/^(npx\s+)?vercel\b(?!\s+(ls|list|inspect|logs|whoami|--version)\b)/, "deploy", "Vercel deploy/config"],
  [/^(npx\s+)?supabase\s+(secrets|login|logout|link|unlink)\b/, "secret-change", "Supabase credentials/secrets"],
  [/^(npx\s+)?supabase\s+(functions\s+(deploy|delete|new)|db\s+(push|reset|dump|pull)|migration\s+(up|repair|squash|new)|storage|projects\s+(create|delete)|orgs|branches|gen|stop|start|init|sso|domains|vanity-subdomains|network-restrictions|ssl-enforcement|postgres-config)\b/, "supabase-cli", "Supabase CLI change"],
  [/^(npm|pnpm|yarn|bun)\s+(install|i|add|ci|uninstall|remove|rm|update|upgrade|link)\b/, "packages", "installing/changing packages"],
  [/^npx\s+(--yes|-y)\b/, "packages", "npx auto-install of an unvetted package"],
  [/^(pip|pip3|brew|choco|winget|scoop)\s+/, "packages", "installing system packages"],
  [/migrate-caddie-media-private.*--apply/, "storage-change", "Storage backfill apply stage"],
  [/^(xcodebuild|xcrun|fastlane|pod|altool)\b/, "ios-release", "iOS build/upload"],
  [/^npx\s+cap\b/, "ios-release", "Capacitor native sync/open"],
  [/^(Set-ExecutionPolicy|reg|schtasks|sc\.exe|setx|net\s+user|netsh)\b/i, "system-change", "system configuration change"],
  [/^(Stop-Process|taskkill|kill|pkill|killall)\b/i, "process-kill", "killing processes"],
  [/(\$PROFILE|profile\.ps1)/i, "security-boundary", "PowerShell profile"],
  [/tools\/review-gate\/task\.mjs\s+cancel\b/, "review-task-cancel", "cancelling an active review task"],
  [LIVE_CHECK, "reviewer-live-call", "live OpenAI reviewer check (spends API budget)"],
];

const EXTERNAL_TOOLS = /^(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const EXTERNAL_WRITE = /(\s-X\s*|--request\s+|-Method\s+)(POST|PUT|PATCH|DELETE)\b|\s(-d|--data(-binary|-raw|-urlencode)?|-F|--form|-Body|-T|--upload-file)\b/i;

const REVIEWER_SEGMENT = [[/^git\s+commit\b/, "git-commit", "git commit"]];

const AUTO_SEGMENT = [
  /^git\s+(status|diff|log|show|rev-parse|ls-files|ls-tree|blame|grep|describe|shortlog|fetch|merge-base|cat-file|rev-list|for-each-ref|add|remote(\s+(-v|get-url|show))?|branch(\s+(-a|-r|-v|-vv|--list|--show-current))*|stash\s+list|config\s+(--get|--list|-l)|tag(\s+(-l|--list))?\s*$|tag\s*$)\b/,
  /^(ls|dir|pwd|cd|echo|printf|cat|type|head|tail|less|more|wc|grep|rg|find|awk|sort|uniq|cut|tr|jq|diff|stat|file|which|where|test|true|false|sleep|date|basename|dirname|realpath|du|tree|env\s*$|nl|column|xxd|od|md5sum|sha256sum)\b/,
  /^sed\s+-n\b/,
  /^(Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Test-Path|Get-Item|gi|Get-Command|gcm|Resolve-Path|Measure-Object|Write-Output|Write-Host|Format-List|fl|Format-Table|ft|Select-Object|select|Where-Object|where|ForEach-Object|foreach|Sort-Object|sort|Out-String|Get-Date|Get-Location|Split-Path|Join-Path|ConvertFrom-Json|ConvertTo-Json|Get-Process|Get-FileHash|Compare-Object|Group-Object)\b/i,
  /^node\s+(-v|--version)\s*$/,
  /^node\s+--test\s+tools\/review-gate\/test\b/,
  /^node\s+tools\/review-gate\/(review|task)\.mjs\b/,
  /^npx\s+(tsc|oxlint|vite|eslint|vitest|playwright\s+test|prettier\s+--check|tsx\s+--version)\b/,
  /^npm\s+(run\s+(lint|build|dev|preview|test|typecheck)|test|ls|view|outdated|audit\s*$|--version|-v)\b/,
  /^(npx\s+)?supabase\s+(projects\s+list|functions\s+list|--version|-v|status|--help)\b/,
  /^(npx\s+)?vercel\s+(ls|list|inspect|logs|whoami|--version)\b/,
  /^claude\s+--version\b/,
  /^(timeout\s+\d+\s+)?bash\s+-c\s+'until\s+curl\s+-sf\s+http:\/\/localhost:\d+/,
];

const OBFUSCATION = [
  /\b(eval|iex|Invoke-Expression)\b/i,
  /\s-(e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i,
  /base64\s+(-d|--decode)[^|]*\|\s*(sh|bash|zsh|node|powershell|pwsh|python)/i,
  /\|\s*(sh|bash|zsh|pwsh|powershell)(\s|$)/i,
  /\$\(\s*curl\b/i,
];

function splitSegments(cmd) {
  return cmd
    .split(/&&|\|\||;|\r?\n|\|/)
    .map((s) => s.trim().replace(/^\(+|\)+$/g, "").trim())
    .map((s) => s.replace(/^((\w+=\S*)\s+)+/, "").trim()) // leading VAR=value assignments
    .filter(Boolean);
}

function secretRegexes(policy) {
  return policy.secretPathPatterns.map((p) => new RegExp(p, "i"));
}

function pathTokens(segment) {
  return (segment.match(/[^\s"'`=<>|;]+/g) ?? []).map(toPosix);
}

function classifyPathForWrite(rel, policy, ctx) {
  if (rel === null) return null;
  if (matchesAny(rel, policy.prohibitedWritePaths)) return result("prohibited", "gate-tamper", `writing ${rel} would tamper with Review Gate state`);
  if (matchesAny(rel, policy.securityBoundaryPaths)) return result("human", "security-boundary", `editing ${rel} changes a security/privacy boundary`);
  if (matchesAny(rel, policy.frozenPaths)) return result("human", "frozen-edit", `${rel} is frozen GolfMe architecture`);
  if (ctx.activeTask && !matchesAny(rel, ctx.activeTask.spec.scope)) return result("human", "scope-change", `${rel} is outside review task ${ctx.activeTask.task_id} scope`);
  return null;
}

export function classifyCommand(command, ctx) {
  const policy = ctx.policy;
  const cmd = String(command ?? "");
  let verdict = result("auto", "read-or-local", "no gated pattern");

  // Whole-command checks first.
  if (/REVIEW_GATE/.test(cmd)) return result("prohibited", "gate-tamper", "changing REVIEW_GATE settings from inside a session is prohibited");
  if (cmd.includes(".review-gate-test-repo")) return result("prohibited", "gate-tamper", "creating/using the test-repo marker in a session is prohibited");
  for (const re of secretRegexes(policy)) {
    if (re.test(cmd)) return result("prohibited", "secret-access", "commands touching secret files (.env, Telegram/OpenAI keys, signing keys) are prohibited");
  }
  const touchesGateFiles = /(\.review-gate(\/|\s|$|["'])|\.claude\/settings|tools\/review-gate\/)/.test(toPosix(cmd));
  if (touchesGateFiles) {
    const segs = splitSegments(toPosix(cmd));
    if (!segs.every((s) => GATE_READONLY.test(s) || LIVE_CHECK.test(s) || /^cd\b/.test(s))) {
      return result("prohibited", "gate-tamper", "modifying Review Gate files or Claude settings via the shell is prohibited");
    }
  }
  for (const re of OBFUSCATION) {
    if (re.test(cmd)) verdict = worst(verdict, result("human", "unclassifiable", "command uses eval/encoded/piped-to-shell execution; risk cannot be determined"));
  }

  for (const segment of splitSegments(toPosix(cmd))) {
    let seg = result("auto", "read-or-local", "no gated pattern");
    let matched = false;
    for (const [re, cls, why] of PROHIBITED_SEGMENT) {
      if (re.test(segment)) {
        seg = result("prohibited", cls, why);
        matched = true;
        break;
      }
    }
    if (!matched)
      for (const [re, cls, why] of HUMAN_SEGMENT) {
        if (re.test(segment)) {
          seg = result("human", cls, why);
          matched = true;
          break;
        }
      }
    if (!matched && EXTERNAL_TOOLS.test(segment)) {
      seg = EXTERNAL_WRITE.test(segment) ? result("human", "external-write", "network write request (POST/PUT/PATCH/DELETE or body upload)") : result("auto", "network-read", "network read");
      matched = true;
    }
    if (!matched)
      for (const [re, cls, why] of REVIEWER_SEGMENT) {
        if (re.test(segment)) {
          seg = ctx.activeTask ? result("reviewer", cls, `${why} inside review task ${ctx.activeTask.task_id}`) : result("auto", cls, `${why} (no active review task)`);
          matched = true;
          break;
        }
      }
    if (!matched && AUTO_SEGMENT.some((re) => re.test(segment))) matched = true;
    if (!matched) {
      seg =
        policy.unknownCommandPolicy === "defer"
          ? result("auto", "unknown-deferred", "unrecognised command deferred to auto mode")
          : result("human", "unknown-command", `unrecognised command, risk cannot be determined: ${segment.slice(0, 80)}`);
    }

    // Writes via shell to protected paths.
    if (WRITE_VERBS.test(segment) || /^sed\s+-i/.test(segment)) {
      if (/^(rm|del|rmdir|Remove-Item|ri)\b.*\s-(r|rf|fr|Recurse)\b/i.test(segment) || /^(rm|Remove-Item)\b.*-Recurse/i.test(segment)) {
        seg = worst(seg, result("human", "delete-recursive", "recursive delete"));
      }
      for (const tok of pathTokens(segment)) {
        if (!/[/.]/.test(tok)) continue;
        const pathVerdict = classifyPathForWrite(repoRelative(ctx.repoRoot, tok), policy, ctx);
        if (pathVerdict) seg = worst(seg, pathVerdict);
      }
    }
    verdict = worst(verdict, seg);
  }
  return verdict;
}

// ---------- File edit tools ----------
export function classifyFileWrite(filePath, ctx) {
  const policy = ctx.policy;
  const posix = toPosix(filePath);
  for (const re of secretRegexes(policy)) {
    if (re.test(posix) || re.test(" " + posix)) return result("prohibited", "secret-access", `writing secret file ${posix} is prohibited`);
  }
  const rel = repoRelative(ctx.repoRoot, filePath);
  if (rel === null) {
    if (matchesAny(posix, policy.writableOutsideRepo)) return result("auto", "scratch-write", "scratchpad/memory write");
    return result("human", "outside-repo", `writing outside the repo: ${posix}`);
  }
  return classifyPathForWrite(rel, policy, ctx) ?? result("auto", "local-edit", ctx.activeTask ? "edit inside review task scope" : "local edit");
}

// ---------- MCP / other tools ----------
const SUPABASE_PREFIX = "mcp__plugin_supabase_supabase__";
const SUPABASE_AUTO = new Set([
  "list_projects",
  "get_project",
  "get_project_url",
  "get_publishable_keys",
  "list_organizations",
  "get_organization",
  "list_tables",
  "list_extensions",
  "list_migrations",
  "list_edge_functions",
  "get_edge_function",
  "list_branches",
  "get_advisors",
  "get_logs",
  "query_logs",
  "search_docs",
  "generate_typescript_types",
]);
const SUPABASE_HUMAN = {
  apply_migration: "supabase-migration",
  deploy_edge_function: "supabase-edge-deploy",
  create_branch: "supabase-admin",
  delete_branch: "supabase-admin",
  merge_branch: "supabase-admin",
  reset_branch: "supabase-admin",
  rebase_branch: "supabase-admin",
  create_project: "supabase-admin",
  pause_project: "supabase-admin",
  restore_project: "supabase-admin",
};

export function classifyToolCall(toolName, toolInput, ctx) {
  const input = toolInput ?? {};
  if (toolName === "Bash" || toolName === "PowerShell") return classifyCommand(input.command, ctx);
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") return classifyFileWrite(input.file_path ?? input.notebook_path ?? "", ctx);
  if (toolName.startsWith(SUPABASE_PREFIX)) {
    const op = toolName.slice(SUPABASE_PREFIX.length);
    if (op === "execute_sql") return isReadOnlySql(input.query) ? result("auto", "sql-read", "read-only SQL") : result("human", "supabase-sql-write", "SQL that is not provably read-only (production data/RLS/policy/storage change)");
    if (SUPABASE_HUMAN[op]) return result("human", SUPABASE_HUMAN[op], `Supabase ${op}`);
    if (SUPABASE_AUTO.has(op)) return result("auto", "supabase-read", `Supabase ${op}`);
    return result("human", "unknown-tool", `unrecognised Supabase tool ${op}`);
  }
  if (toolName === "mcp__claude_ai_Claude_Docs__delete") return result("human", "doc-delete", "deleting a doc");
  if (toolName === "Artifact") {
    const action = input.action ?? "publish";
    if (["read", "list", "open", "quickstart"].includes(action)) return result("auto", "artifact-read", `artifact ${action}`);
    return result("human", "artifact-publish", `artifact ${action}`);
  }
  if (["Read", "Grep", "Glob"].includes(toolName)) {
    const p = toPosix(input.file_path ?? input.path ?? "");
    for (const re of secretRegexes(ctx.policy)) if (re.test(p) || re.test(" " + p)) return result("prohibited", "secret-access", "reading secret files is prohibited");
    return result("auto", "read", "read");
  }
  return result("auto", "unmatched-tool", "tool not covered by the gate");
}
