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
let lastAheadLogged = -1;
let lastUntrackedLogged = "";

async function tick() {
  if (paused) return;

  const status = tryRun("git status --porcelain");
  if (!status.ok) {
    log(`git status failed: ${status.out}`);
    return;
  }

  // Only auto-stage changes to files git already tracks (-u), never new files.
  // A blind `git add -A` would also sweep up untracked scratch/debug files
  // (e.g. one-off .tmp.cjs scripts) into commits without you ever asking for it.
  const trackedChanges = status.out
    .split("\n")
    .filter((l) => l && !l.startsWith("??"));
  const untracked = status.out
    .split("\n")
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3));

  if (trackedChanges.length > 0) {
    const commitMsg = `auto-sync: ${new Date().toISOString()}`;
    const add = tryRun("git add -u");
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

  if (untracked.length > 0) {
    const key = untracked.join(",");
    if (key !== lastUntrackedLogged) {
      log(`new untracked file(s) NOT auto-added (add them yourself if intentional): ${untracked.join(", ")}`);
      lastUntrackedLogged = key;
    }
  } else {
    lastUntrackedLogged = "";
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
  if (ahead.ok) {
    const n = Number(ahead.out);
    if (n > 0 && n !== lastAheadLogged) {
      log(`${n} commit(s) ready to push — run 'git push' yourself when ready (auto-sync never pushes).`);
    }
    lastAheadLogged = n;
  }
}

log(`watching for changes every ${SYNC_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
setInterval(tick, SYNC_INTERVAL_MS);
tick();
