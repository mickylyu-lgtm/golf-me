// Permission classifier: maps one Claude Code tool call to a tier.
//   auto        -> hook stays silent (normal auto mode applies)
//   reviewer    -> needs a DONE verdict for the current work hash (inside a review task)
//   human       -> hook returns "ask" (Claude Code's own permission prompt, relayed to Telegram)
//   prohibited  -> hook returns "deny"
// The classifier never produces "allow": the gate can only add restrictions.
import { tmpdir } from "node:os";
import { splitShell } from "./shell.mjs";
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
// Segments are parsed by lib/shell.mjs: quote-, heredoc- and comment-aware, with
// command substitutions returned as extra segments. seg.text is verbatim;
// seg.bare has quoted contents removed.

const GATE_PATH = /(\.review-gate(\/|\s|$|["'])|\.claude(\/settings|\/agents|\/?\s|\/?$|\/?["'])|tools\/review-gate(\/|\s|$|["']))/;

// Review Gate commands a session may run.
const LIVE_CHECK = /^node\s+tools\/review-gate\/live-check\.mjs(\s+--case(=|\s+)[a-z,]+)?\s*$/; // spends budget: human
const TASK_START = /^node\s+tools\/review-gate\/task\.mjs\s+start\s+--spec(-json)?\s/; // explicit approval: human
const TASK_CANCEL = /^node\s+tools\/review-gate\/task\.mjs\s+cancel\s*$/; // human
const TASK_AUTO = /^node\s+tools\/review-gate\/task\.mjs\s+(status|done|note\s+F\d{1,3}\s+(addressed|disputed|open)\b|tests\s+\S+\s*$)/;
const GATE_TEST = /^node\s+--test\s+["']?tools\/review-gate\/test\S*(\s+["']?tools\/review-gate\/test\S*)*\s*$/;
const GATE_REVIEW = /^node\s+tools\/review-gate\/review\.mjs(\s+(--json|--dry-run))*\s*$/;

// Pure readers / text filters: cannot change anything on their own (redirect targets are checked separately).
const READ_ONLY =
  /^(cat|type|less|more|head|tail|ls|dir|grep|egrep|rg|wc|cut|sort|uniq|tr|column|nl|od|xxd|jq|diff|cmp|stat|file|basename|dirname|realpath|md5sum|sha256sum|sed\s+-n|awk|find|tree|git\s+(status|diff|log|show|blame|ls-files|grep)|Get-Content|gc|Get-ChildItem|gci|Select-String|sls|Test-Path|Select-Object|Measure-Object|Sort-Object|Get-FileHash)\b/i;
const FIND_WRITES = /^find\b.*\s-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)\b/;
const AWK_RUNS = /^awk\b.*(system\s*\(|\|\s*getline|print[^;'"]*\|)/;

function isReadOnly(seg) {
  const t = stripRedirects(seg.text);
  return READ_ONLY.test(t) && !FIND_WRITES.test(t) && !AWK_RUNS.test(t) && !/^sed\b.*\s(-i|--in-place)\b/.test(t);
}

// Redirections removed, so anchored command patterns still match "cmd > out 2>&1".
// Redirect targets are classified separately by writeTargets().
const REDIRECT = /\s*\d*(?:&>>?|>>?|>\||<)\s*(?:&\d+|"[^"]*"|'[^']*'|[^\s;|&<>()]+)/g;
export function stripRedirects(text) {
  return text.replace(REDIRECT, "").trim();
}

function gateAllowed(seg) {
  const t = stripRedirects(seg.text);
  return /^cd\b/.test(t) || LIVE_CHECK.test(t) || TASK_START.test(t) || TASK_CANCEL.test(t) || TASK_AUTO.test(t) || GATE_TEST.test(t) || GATE_REVIEW.test(t) || isReadOnly(seg);
}

// Commands whose quoted arguments are message text, not paths or code.
const MESSAGE_CMD = /^(git\s+(commit|tag|notes|stash\s+push)|echo|printf|Write-Output|Write-Host|gh\s+(pr|issue)\s+(create|comment|edit))\b/;

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
  [TASK_CANCEL, "review-task-cancel", "cancelling an active review task"],
  [TASK_START, "review-task-start", "starting a review task — approving this starts the reviewer loop for the objective and scope in this command"],
  [LIVE_CHECK, "reviewer-live-call", "live OpenAI reviewer check (spends API budget)"],
  [FIND_WRITES, "find-exec", "find with -exec/-delete runs commands or deletes files"],
  [AWK_RUNS, "unclassifiable", "awk program runs shell commands"],
  [/^(sh|bash|zsh|dash|pwsh|powershell|python3?|node|perl|ruby)\s*$/, "unclassifiable", "interpreter reading piped/redirected input; risk cannot be determined"],
];

const EXTERNAL_TOOLS = /^(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const EXTERNAL_WRITE = /(\s-X\s*|--request\s+|-Method\s+)(POST|PUT|PATCH|DELETE)\b|\s(-d|--data(-binary|-raw|-urlencode)?|-F|--form|-Body|-T|--upload-file)\b/i;

const REVIEWER_SEGMENT = [[/^git\s+commit\b/, "git-commit", "git commit"]];

const AUTO_SEGMENT = [
  /^git\s+(status|diff|log|show|rev-parse|ls-files|ls-tree|blame|grep|describe|shortlog|fetch|merge-base|cat-file|rev-list|for-each-ref|add|remote(\s+(-v|get-url|show))?|branch(\s+(-a|-r|-v|-vv|--list|--show-current))*|stash\s+list|config\s+(--get|--list|-l)|tag(\s+(-l|--list))?\s*$|tag\s*$)\b/,
  /^(ls|dir|pwd|cd|echo|printf|cat|type|head|tail|less|more|wc|grep|egrep|rg|find|awk|sort|uniq|cut|tr|jq|diff|cmp|stat|file|which|where|test|true|false|sleep|date|basename|dirname|realpath|du|tree|env\s*$|nl|column|xxd|od|md5sum|sha256sum)\b/,
  /^sed\s+-n\b/,
  // local file operations: their write targets are classified below (protected paths stay gated)
  /^(rm|rmdir|mkdir|touch|cp|mv|tee)\b/,
  /^sed\s+(-i|--in-place)\b/,
  /^set\s+([-+][a-zA-Z]*o\s+\w+|[-+][a-zA-Z]+)(\s+([-+][a-zA-Z]*o\s+\w+|[-+][a-zA-Z]+))*\s*$/,
  /^export\s+[A-Za-z_]\w*=/,
  /^for\s+[A-Za-z_]\w*\s+in\b/,
  /^\[\[?\s/,
  /^(Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Test-Path|Get-Item|gi|Get-Command|gcm|Resolve-Path|Measure-Object|Write-Output|Write-Host|Format-List|fl|Format-Table|ft|Select-Object|select|Where-Object|where|ForEach-Object|foreach|Sort-Object|sort|Out-String|Get-Date|Get-Location|Split-Path|Join-Path|ConvertFrom-Json|ConvertTo-Json|Get-Process|Get-FileHash|Compare-Object|Group-Object)\b/i,
  /^node\s+(-v|--version)\s*$/,
  GATE_TEST,
  GATE_REVIEW,
  TASK_AUTO,
  /^npx\s+(tsc|oxlint|vite|eslint|vitest|playwright\s+test|prettier\s+--check|tsx\s+--version)\b/,
  /^npm\s+(run\s+(lint|build|dev|preview|test|typecheck)|test|ls|view|outdated|audit\s*$|--version|-v)\b/,
  /^(npx\s+)?supabase\s+(projects\s+list|functions\s+list|--version|-v|status|--help)\b/,
  /^(npx\s+)?vercel\s+(ls|list|inspect|logs|whoami|--version)\b/,
  /^claude\s+--version\b/,
];

// Checked on the command with quoted contents removed (plus heredoc bodies).
const OBFUSCATION = [
  /\b(eval|iex|Invoke-Expression)\b/i,
  /\s-(e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i,
  /base64\s+(-d|--decode)[^|]*\|\s*(sh|bash|zsh|node|powershell|pwsh|python)/i,
  /\|\s*(sh|bash|zsh|pwsh|powershell)(\s|$)/i,
  /\$\(\s*curl\b/i,
];

function secretRegexes(policy) {
  return policy.secretPathPatterns.map((p) => new RegExp(p, "i"));
}

// ---------- write targets ----------
const unquote = (t) => t.replace(/^(["'])([\s\S]*)\1$/, "$2");
const argv = (text) => (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map(unquote);

const VERB_ALL_ARGS = /^(rm|del|rmdir|mkdir|touch|truncate|tee|Remove-Item|ri|Set-Content|sc|Add-Content|ac|Out-File|New-Item|ni|Clear-Content|mv|Move-Item|mi|Rename-Item|rni)$/i;
const VERB_LAST_ARG = /^(cp|Copy-Item|cpi)$/i;

// Paths a segment writes to: redirect targets, plus the operands of file-changing verbs.
export function writeTargets(seg) {
  const targets = [];
  const redirect = /(?:^|[^<>&\d])\d*(?:&>>?|>>?|>\|)\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g;
  let m;
  // Only when a redirect exists outside quotes (a ">" inside a commit message is not one).
  if (/>/.test(seg.bare ?? seg.text)) while ((m = redirect.exec(seg.text))) if (!m[1].startsWith("&")) targets.push(unquote(m[1]));
  const args = argv(seg.text.replace(/\d*(?:&>>?|>>?|>\|)\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g, " "));
  const verb = args[0] ?? "";
  const operands = args.slice(1).filter((a) => !/^-/.test(a));
  if (VERB_ALL_ARGS.test(verb)) targets.push(...operands);
  else if (VERB_LAST_ARG.test(verb) && operands.length) targets.push(operands[operands.length - 1]);
  else if (/^sed$/.test(verb) && args.some((a) => /^(-i|--in-place)/.test(a))) targets.push(...operands.slice(1)); // skip the script
  else if (/^perl$/.test(verb) && args.some((a) => /^-[a-z]*i/.test(a))) targets.push(...operands.slice(1));
  return targets;
}

const TEMP_ROOT = toPosix(tmpdir()).toLowerCase().replace(/\/+$/, "");
const HARMLESS_TARGET = /^(\/dev\/(null|stdout|stderr|tty)|nul|con)$/i;
const TEMP_VAR = /^(\$\{?(TEMP|TMP|TMPDIR)\}?|%(TEMP|TMP)%|\$env:(TEMP|TMP))([\\/]|$)/i;

function classifyWriteTarget(raw, policy, ctx) {
  const tok = toPosix(raw);
  if (!tok || HARMLESS_TARGET.test(tok)) return null;
  if (TEMP_VAR.test(tok)) return null;
  if (/^[$%]/.test(tok)) return result("human", "outside-repo", `write to a path given by a variable (${tok.slice(0, 60)})`);
  if (/^~([/]|$)/.test(tok)) return result("human", "outside-repo", `writing in the home directory: ${tok.slice(0, 80)}`);
  const abs = tok.replace(/^\/([a-zA-Z])\//, "$1:/"); // Git Bash /c/... -> C:/...
  const rel = repoRelative(ctx.repoRoot, abs);
  if (rel === null) {
    const lower = abs.toLowerCase();
    if (lower.startsWith(TEMP_ROOT + "/") || lower.startsWith("/tmp/") || matchesAny(abs, policy.writableOutsideRepo)) return null;
    return result("human", "outside-repo", `writing outside the repo: ${tok.slice(0, 80)}`);
  }
  return classifyPathForWrite(rel, policy, ctx);
}

function classifyPathForWrite(rel, policy, ctx) {
  if (rel === null) return null;
  if (matchesAny(rel, policy.prohibitedWritePaths)) return result("prohibited", "gate-tamper", `writing ${rel} would tamper with Review Gate state`);
  if (matchesAny(rel, policy.securityBoundaryPaths)) return result("human", "security-boundary", `editing ${rel} changes a security/privacy boundary`);
  if (matchesAny(rel, policy.frozenPaths)) return result("human", "frozen-edit", `${rel} is frozen GolfMe architecture`);
  if (ctx.activeTask && !matchesAny(rel, ctx.activeTask.spec.scope)) return result("human", "scope-change", `${rel} is outside review task ${ctx.activeTask.task_id} scope`);
  return null;
}

function classifySegment(seg, ctx, depth) {
  const policy = ctx.policy;
  const segment = stripRedirects(seg.text);

  // bash -c '<script>' / sh -c "<script>": classify the script itself.
  const inner = /^(bash|sh|zsh)\s+-c\s+(['"])([\s\S]*)\2\s*$/.exec(segment);
  if (inner && depth < 4) return classifyCommand(inner[3], ctx, "bash", depth + 1);

  let seg_ = null;
  for (const [re, cls, why] of PROHIBITED_SEGMENT) if (re.test(segment)) seg_ ??= result("prohibited", cls, why);
  if (!seg_) for (const [re, cls, why] of HUMAN_SEGMENT) if (re.test(segment)) seg_ ??= result("human", cls, why);
  if (!seg_ && EXTERNAL_TOOLS.test(segment)) {
    seg_ = EXTERNAL_WRITE.test(segment) ? result("human", "external-write", "network write request (POST/PUT/PATCH/DELETE or body upload)") : result("auto", "network-read", "network read");
  }
  if (!seg_)
    for (const [re, cls, why] of REVIEWER_SEGMENT)
      if (re.test(segment)) seg_ ??= ctx.activeTask ? result("reviewer", cls, `${why} inside review task ${ctx.activeTask.task_id}`) : result("auto", cls, `${why} (no active review task)`);
  if (!seg_ && AUTO_SEGMENT.some((re) => re.test(segment))) seg_ = result("auto", "read-or-local", "no gated pattern");
  if (!seg_) {
    seg_ =
      policy.unknownCommandPolicy === "defer"
        ? result("auto", "unknown-deferred", "unrecognised command deferred to auto mode")
        : result("human", "unknown-command", `unrecognised command, risk cannot be determined: ${segment.slice(0, 80)}`);
  }

  // Writes: only real write targets count (redirect targets, file-verb operands).
  if (/^(rm|del|rmdir|Remove-Item|ri)\b/i.test(segment) && /\s-[a-zA-Z]*[rR][a-zA-Z]*\b|\s--recursive\b|-Recurse\b|\s\/s\b/i.test(segment)) {
    seg_ = worst(seg_, result("human", "delete-recursive", "recursive delete"));
  }
  for (const t of writeTargets(seg)) {
    const v = classifyWriteTarget(t, policy, ctx);
    if (v) seg_ = worst(seg_, v);
  }
  return seg_;
}

export function classifyCommand(command, ctx, dialect = "bash", depth = 0) {
  const policy = ctx.policy;
  const raw = String(command ?? "");
  const cmd = toPosix(raw);
  // Parse the raw text (backslashes are escapes in bash), then normalise paths for matching.
  const p = splitShell(raw, dialect);
  const parsed = {
    unbalanced: p.unbalanced,
    bare: toPosix(p.bare),
    heredocBodies: p.heredocBodies.map(toPosix),
    segments: p.segments.map((s) => ({ text: toPosix(s.text), bare: toPosix(s.bare), heredoc: toPosix(s.heredoc) })),
  };
  const secrets = secretRegexes(policy);

  // Unparseable: fall back to conservative whole-command checks.
  if (parsed.unbalanced) {
    if (/REVIEW_GATE|\.review-gate-test-repo/.test(cmd)) return result("prohibited", "gate-tamper", "changing REVIEW_GATE settings from inside a session is prohibited");
    for (const re of secrets) if (re.test(cmd)) return result("prohibited", "secret-access", "commands touching secret files (.env, Telegram/OpenAI keys, signing keys) are prohibited");
    if (GATE_PATH.test(cmd)) return result("prohibited", "gate-tamper", "unparseable command touching Review Gate files or Claude settings");
    return result("human", "unclassifiable", "quotes, substitutions or heredocs do not close; risk cannot be determined");
  }

  // What the command can actually act on: message text is excluded, heredoc bodies included.
  const isMessage = (s) => MESSAGE_CMD.test(s.text) && !writeTargets(s).length;
  const haystack = [...parsed.segments.map((s) => (isMessage(s) ? s.bare : s.text)), ...parsed.heredocBodies].join("\n");

  if (/REVIEW_GATE/.test(haystack) || /REVIEW_GATE/.test(parsed.bare)) return result("prohibited", "gate-tamper", "changing REVIEW_GATE settings from inside a session is prohibited");
  if (haystack.includes(".review-gate-test-repo")) return result("prohibited", "gate-tamper", "creating/using the test-repo marker in a session is prohibited");
  for (const re of secrets) {
    if (re.test(haystack)) return result("prohibited", "secret-access", "commands touching secret files (.env, Telegram/OpenAI keys, signing keys) are prohibited");
  }

  // Review Gate files and Claude settings: only read-only use and the gate's own commands.
  // Strict mode (every segment must qualify) after cd into a gate directory, or when a
  // heredoc body mentions gate paths, since relative paths / scripts then act on the gate.
  const gateSeg = (s) => GATE_PATH.test(isMessage(s) ? s.bare : s.text);
  const strict = parsed.segments.some((s) => /^cd\b/.test(s.text) && GATE_PATH.test(s.text + "/")) || parsed.heredocBodies.some((b) => GATE_PATH.test(b));
  const mustCheck = strict ? parsed.segments : parsed.segments.filter(gateSeg);
  if (mustCheck.some((s) => !gateAllowed(s))) {
    return result("prohibited", "gate-tamper", "modifying Review Gate files or Claude settings via the shell is prohibited");
  }

  let verdict = result("auto", "read-or-local", "no gated pattern");
  const obfuscationText = [parsed.bare, ...parsed.heredocBodies].join("\n");
  for (const re of OBFUSCATION) {
    if (re.test(obfuscationText)) verdict = worst(verdict, result("human", "unclassifiable", "command uses eval/encoded/piped-to-shell execution; risk cannot be determined"));
  }
  for (const seg of parsed.segments) verdict = worst(verdict, classifySegment(seg, ctx, depth));
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
  if (toolName === "Bash") return classifyCommand(input.command, ctx, "bash");
  if (toolName === "PowerShell") return classifyCommand(input.command, ctx, "ps");
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
