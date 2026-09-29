# GolfMe Review Gate (development tooling)

Local, approval-gated review loop for Claude Code sessions in this repo. Claude builds; an OpenAI model reviews independently. **Not part of the GolfMe app**: never imported by `src/`, excluded from Vercel (`.vercelignore`), no npm dependencies, no server.

## What it does
- **PreToolUse hook** (`hooks/pretool.mjs`) classifies each matched tool call and returns `deny`, `ask` or nothing. It **never returns `allow`**. `ask` makes Claude Code show its own permission prompt, which the Telegram plugin relays with Allow/Deny buttons. Only that harness prompt counts as human approval; typed messages and reviewer output never do.
- **Stop hook** (`hooks/stop.mjs`) runs the reviewer at the end of a turn **only while a review task is active**:
  - `REVISE` → blocks the stop and hands the findings to Claude as untrusted data (max 3 cycles).
  - `CONTINUE` (fresh verdict) → blocks the stop so Claude keeps going inside the approved scope (max 8 per task; a cached CONTINUE for unchanged work lets Claude stop).
  - `USER_APPROVAL_REQUIRED` / `BLOCKED` / `DONE` / reviewer unavailable → blocks once so Claude sends Micky a Telegram status, then allows.
- **Reviewer** (`review.mjs`) builds a sanitized payload, checks budget, calls the reviewer, validates the strict response and records verdicts bound to a work hash.

## Real reviewer (P0, enabled 2026-09-29)
- Transport: `lib/openai.mjs` — OpenAI **Responses API** with **Structured Outputs** (`text.format` = strict `json_schema`), `store: false`, built-in `fetch`, no SDK.
- Model: `policy.json` → `model` (`gpt-6-sol`), `reasoningEffort` (`medium`), `pricing` (USD per 1M tokens, from the official pricing page). Unknown pricing = no calls.
- **API key**: a single line in `%USERPROFILE%\.golfme-review\openai.key` (outside the repo). Read only at call time by the transport, sent only in the `Authorization` header, never logged or stored elsewhere. Not read from environment variables (every shell command a session runs can see those). Claude cannot read that folder (settings deny + hook).
- The request contains only the sanitized review package: objective, requirements, scope, constraints, sanitized diff, up to 3 file excerpts, test results, previous findings. Never the whole repo.
- The response is validated locally against `schema/response.schema.json` (unknown/missing fields, wrong task or work hash, bad enums → rejected). Refusals and incomplete responses count as malformed.

### Live self-test
```
node tools/review-gate/live-check.mjs                 # cases: secret, done, revise
node tools/review-gate/live-check.mjs --case revise
```
Synthetic `clampPercent` code only. `secret` must be refused before sending; `done`/`revise` make real calls, go through the same budget checks, and are recorded in the ledger as `LIVE-CHECK`. Human-gated (spends money).

## Tiers (see `lib/classify.mjs`, `policy.json`)
auto (silent) · reviewer (needs DONE for the current work hash) · human (ask) · prohibited (deny).
Frozen areas (DirectMessageThread, BottomNav, keyboard code, `capacitor.config.ts`, `ios/**`) and the gate itself are always human-gated.

### How shell commands are read (P1, 2026-09-29)
- `lib/shell.mjs` parses commands before classifying: `|`, `;`, `&&` inside quotes, heredoc bodies or comments do **not** split a command, so grep patterns and commit messages no longer trigger prompts. `$(…)`, backticks and `<(…)` run commands even inside double quotes and unquoted heredocs, so their contents are classified too (`echo $(git push)` is a push). `bash -c '…'` is classified by its script. Unbalanced quotes/heredocs are never auto.
- Writes: only real targets count — redirect targets, `rm`/`mv`/`touch`/`tee`/`sed -i` operands, the `cp` destination. Protected targets stay gated; writes outside the repo are human except temp/scratch.
- Review Gate files: read-only commands (including pipes into filters) and the gate's own commands are allowed; anything else touching `tools/review-gate`, `.review-gate` or `.claude` settings is denied, and after `cd` into a gate folder every command must be read-only.
- `task.mjs start --spec-json '<json>'` is human-gated: **approving that prompt is the explicit approval that starts the reviewer loop**, and the prompt shows the objective and scope. `status`, `note`, `tests`, `done` are auto; `cancel` is human.
- Still human: unknown programs (`node script.js`, `python`, `npx tsx`), `find -exec/-delete`, `awk system()`, piping into an interpreter, eval/encoded commands.

## Review tasks
```
node tools/review-gate/task.mjs start --spec <spec.json>   # objective, scope globs, requirements, risk, rollback…
node tools/review-gate/task.mjs status
node tools/review-gate/task.mjs note F1 disputed "why"
node tools/review-gate/task.mjs done                        # needs DONE for the current hash
node tools/review-gate/task.mjs cancel                      # human-gated
node tools/review-gate/review.mjs --dry-run                 # build the sanitized payload without sending
```

## Limits (policy.json)
3 REVISE cycles/task · 8 CONTINUE cycles/task · 2 disputes/finding · 10 reviewer calls/day · $2/day soft stop · $10/month cap (also set it as the OpenAI project budget) · 60k-char payload · 8k output tokens · 90 s per request, 240 s per review · 2 retries (2 s, 8 s; Retry-After ≤ 30 s) for network/timeout/429/5xx · no retry on other 4xx · 1 retry for malformed output · 7-day payload retention.

## State (`.review-gate/`, gitignored)
`active-task.json`, `tasks/`, `verdicts/<hash>.json`, `ledger.jsonl` (metadata: task, cycle, tokens, cost, outcome), `audit.jsonl` (metadata only), `payloads/` (exact sanitized payloads, auto-deleted after 7 days). All state is on disk, so a restarted Claude or machine resumes from it; verdicts are cached by work hash, so nothing is billed twice.

## Tests
`node --test tools/review-gate/test/*.test.mjs` — throwaway temp repos, fake credentials, a local fake Responses API on 127.0.0.1. Test processes can never reach the real endpoint or key file.

## Turning it off / removal
- Reviewer only: `$env:REVIEW_GATE='off'; golfme` (human gates stay on). Cannot be set from inside a session.
- Real calls only: set `realCallsEnabled` to `false` in `policy.json` (human-gated edit).
- Whole gate: delete `.claude/settings.local.json` outside Claude, restart Claude.
- Removal: delete `.claude/settings.local.json`, `tools/review-gate/`, `.review-gate/`, the `.gitignore` lines and `.vercelignore`; also `%USERPROFILE%\.golfme-review\` and revoke the reviewer key.
