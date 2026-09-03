// Background git auto-sync for working on GolfMe from multiple machines.
// Polls every SYNC_INTERVAL_MS: commits local changes, then pulls (rebase) remote changes.
// Never pushes automatically — GolfMe's working agreement requires asking before every push.
// Run with: npm run sync
import { execSync } from "node:child_process";

const SYNC_INTERVAL_MS = 15_000;

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function tryRun(cmd) {
  try {
    return { ok: true, out: run(cmd) };
  } catch (err) {
    return { ok: false, out: (err.stdout || "") + (err.stderr || err.message) };
  }
}

function log(msg) {
  console.log(`[auto-sync ${new Date().toLocaleTimeString()}] ${msg}`);
}

let paused = false;

async function tick() {
  if (paused) return;

  const status = tryRun("git status --porcelain");
  if (!status.ok) {
    log(`git status failed: ${status.out}`);
    return;
  }

  if (status.out.length > 0) {
    const commitMsg = `auto-sync: ${new Date().toISOString()}`;
    const add = tryRun("git add -A");
    if (!add.ok) {
      log(`git add failed: ${add.out}`);
      return;
    }
    const commit = tryRun(`git commit -m "${commitMsg}"`);
    if (!commit.ok) {
      log(`git commit failed: ${commit.out}`);
      return;
    }
    log(`committed local changes (${commitMsg})`);
  }

  const pull = tryRun("git pull --rebase --autostash");
  if (!pull.ok) {
    log(`PULL/REBASE FAILED — likely a conflict. Auto-sync paused until you resolve it manually.`);
    log(pull.out);
    tryRun("git rebase --abort");
    paused = true;
    log(`Resolve manually (git status), then restart: npm run sync`);
    return;
  }

  const ahead = tryRun("git rev-list --count @{u}..HEAD");
  if (ahead.ok && Number(ahead.out) > 0) {
    log(`${ahead.out} commit(s) ready to push — run 'git push' yourself when ready (auto-sync never pushes).`);
  }
}

log(`watching for changes every ${SYNC_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
setInterval(tick, SYNC_INTERVAL_MS);
tick();
