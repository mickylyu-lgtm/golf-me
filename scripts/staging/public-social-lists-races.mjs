// Opt-in, synthetic LOCAL PostgreSQL concurrency harness. No Supabase calls.
// Requires a NEW, dedicated disposable NORMAL PostgreSQL cluster, psql on PATH
// (or PSQL), and an empty
// database named exactly golfme_private_social_test. Never use production.
// First run: PGHOST=/approved/local/socket PGDATABASE=golfme_private_social_test \
//   node scripts/staging/private-social-controls-races.mjs --prepare-empty-synthetic-db \
//     --acknowledge-dedicated-disposable-cluster
// Start that authorized server with -c golfme.test_cluster=private-social-controls-disposable-v1.
// An empty DB in an otherwise used local cluster is NOT sufficient: preparation
// commits the cluster-global authenticated, anon and service_role roles.
// Preparation runs the entire authorization fixture and commits ONLY synthetic
// fixtures after all its assertions pass. Subsequent runs require its marker.
// No server is installed or started here. All database content remains available
// for inspection afterwards; this script does not drop the test database.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (!process.argv.includes("--acknowledge-dedicated-disposable-cluster")) throw new Error("Explicit dedicated disposable cluster acknowledgment is required; roles are cluster-global.");
const psql = process.env.PSQL || "psql";
const host = process.env.PGHOST || "";
if (process.env.PGDATABASE !== "golfme_private_social_test"
    || !host || !(host.startsWith("/") || ["localhost", "127.0.0.1", "::1"].includes(host))
    || host.includes(",") || process.env.PGSERVICE
    || (process.env.PGHOSTADDR && !["127.0.0.1", "::1"].includes(process.env.PGHOSTADDR))) {
  throw new Error("Refusing: explicit local PGHOST, exact synthetic PGDATABASE and no PGSERVICE are required.");
}
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const scalar = (sql) => execFileSync(psql, [...args, "-c", sql], { encoding: "utf8" }).trim();
if (scalar("select current_database()") !== "golfme_private_social_test") throw new Error("Wrong database");
if (scalar("select coalesce(current_setting('golfme.test_cluster',true),'')") !== "private-social-controls-disposable-v1") throw new Error("Dedicated disposable server marker is required");
if (scalar("select exists(select 1 from pg_database where datname not in('postgres','template0','template1','golfme_private_social_test')) or exists(select 1 from pg_roles where rolname !~ '^pg_' and rolname not in(session_user,'authenticated','anon','service_role'))") !== "f") throw new Error("Unexpected database/role in cluster; use a new dedicated disposable cluster");
const serverAddress = scalar("select coalesce(inet_server_addr()::text,'unix_socket')");
if (!["unix_socket", "127.0.0.1", "::1"].includes(serverAddress)) throw new Error("Refusing nonlocal server");
const prepare = process.argv.includes("--prepare-empty-synthetic-db");
function expandSql(path) {
  return readFileSync(path, "utf8").split("\n").flatMap((line) => {
    const include = line.match(/^\\ir\s+(.+)$/);
    return include ? [expandSql(resolve(dirname(path), include[1].trim()))] : [line];
  }).join("\n");
}
if (prepare) {
  // The fixture preflight rejects all nondefault schemas, relations, routines,
  // types, extensions and other user objects before any setup is committed.
  const original = expandSql(join(here, "public-social-lists-authz.sql"));
  if (!/rollback;\s*\\echo[^\n]*\s*$/.test(original)) throw new Error("Unexpected fixture trailer");
  const setup = original.replace(/rollback;\s*\\echo[^\n]*\s*$/, `
create table public.private_social_race_fixture (version integer not null check(version=1));
insert into public.private_social_race_fixture values(1);
commit;
`);
  const tempRoot = resolve(tmpdir());
  const temp = mkdtempSync(join(tempRoot, "golfme-social-races-"));
  if (dirname(resolve(temp)) !== tempRoot || !basename(temp).startsWith("golfme-social-races-")) throw new Error("Unsafe temporary directory");
  try {
    const path = join(temp, "synthetic-setup.sql");
    writeFileSync(path, setup);
    execFileSync(psql, [...args, "-f", path], { stdio: ["ignore", "pipe", "pipe"] });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (scalar("select to_regclass('public.private_social_race_fixture') is not null") !== "t"
    || scalar("select count(*)=1 and min(version)=1 from public.private_social_race_fixture") !== "t"
    || scalar("select count(*)=60 and bool_and(id::text like '00000000-0000-0000-0000-%' and right(id::text,12)::integer between 1 and 60 and name=case when right(id::text,12)::integer=13 then '  ' else 'Fixture '||right(id::text,12)::integer end) from public.profiles") !== "t") {
  throw new Error("Refusing: synthetic marker/profile set not verified");
}

let serial = 0;
class Session {
  constructor(name) {
    this.name = name;
    this.output = "";
    this.error = "";
    this.waiter = null;
    this.ended = false;
    this.proc = spawn(psql, args, { env: { ...process.env, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => { this.output += chunk; this.flush(); });
    this.proc.stderr.on("data", (chunk) => { this.error += chunk; });
    this.proc.stdin.on("error", (error) => this.fail(error));
    this.proc.on("error", (error) => { this.ended = true; this.fail(error); });
    this.proc.on("exit", (code) => {
      this.ended = true;
      this.fail(new Error(name + " exited " + code + ": " + this.error));
    });
  }
  fail(error) {
    const waiter = this.waiter;
    this.waiter = null;
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  flush() {
    const waiter = this.waiter;
    if (!waiter) return;
    const end = this.output.indexOf(waiter.marker, waiter.start);
    if (end < 0) return;
    this.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(this.output.slice(waiter.start, end).trim());
  }
  exec(sql) {
    if (this.ended) return Promise.reject(new Error("Session has ended: " + this.name));
    if (this.waiter) return Promise.reject(new Error("Session already busy"));
    const marker = "SOCIAL_MARKER_" + (++serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error("Timed out: " + this.name)); this.proc.kill(); }, 20000);
      this.waiter = { marker, start: this.output.length, resolve, reject, timer };
      this.proc.stdin.write(sql + "\nselect '" + marker + "';\n");
      this.flush();
    });
  }
  close() {
    const busy = Boolean(this.waiter);
    this.fail(new Error("Session closed: " + this.name));
    if (this.ended) return;
    if (busy) this.proc.kill();
    else this.proc.stdin.end("\\q\n");
  }
}
const token = "social_race_" + process.pid;
const a = new Session(token + "_a"), b = new Session(token + "_b"), control = new Session(token + "_control");
const uid = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const quoted = (s) => "'" + s.replaceAll("'", "''") + "'";
const actor = (n, sql) => "set local role authenticated; select set_config('request.jwt.claim.sub'," + quoted(uid(n)) + ",true); " + sql;
const transact = (n, sql) => "begin; " + actor(n, sql) + " commit;";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
async function race(label, first, second, verify) {
  await a.exec("begin; " + first);
  let settled = false, failure;
  const pending = b.exec("begin; " + second + " commit;").then(
    (value) => { settled = true; return value; },
    (error) => { settled = true; failure = error; },
  );
  try {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      if (settled) throw failure || new Error(label + ": second session did not wait on the shared lock");
      const result = await control.exec("select exists(select 1 from pg_stat_activity where application_name=" + quoted(b.name) + " and wait_event_type='Lock');");
      if (result === "t") { blocked = true; break; }
      await pause(25);
    }
    if (!blocked) throw new Error(label + ": did not observe lock contention");
    await a.exec("commit;");
    await pending;
    if (failure) throw failure;
    await control.exec(verify);
    passed++;
    process.stdout.write("PASS " + label + "\n");
  } catch (error) {
    await a.exec("rollback;").catch(() => {});
    await pending;
    throw error;
  }
}
async function request(from, to) {
  await control.exec("update public.profiles set is_private=true where id=u(" + to + ");");
  await control.exec(transact(from, "select follow_golfer(u(" + to + "));"));
  return (await control.exec("select request_id from private.follow_requests where requester_id=u(" + from + ") and target_id=u(" + to + ") and status='pending';")).trim();
}
try {
  await control.exec("begin; set local role authenticated; select test_assert(row_security_active('public.follows'),'normal-server RLS required'); rollback;");
  // Reset only known unused synthetic ids, after the exact marker/profile guard.
  await control.exec(`delete from public.follows where follower_id between u(40) and u(60) or following_id between u(40) and u(60);
delete from private.follow_requests where requester_id between u(40) and u(60) or target_id between u(40) and u(60);
delete from public.blocks where blocker_id between u(40) and u(60) or blocked_id between u(40) and u(60);
delete from public.notifications where user_id between u(40) and u(60);
update public.profiles set is_private=false where id between u(40) and u(60);`);
  await race("privacy switch wins before new follow",
    actor(42, "select set_account_private(true);"),
    actor(41, "select test_assert(follow_golfer(u(42))->>'state'='pending','follow observes committed privacy');"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(41) and following_id=u(42)),'pending race creates no accepted edge');");
  await race("accepted follow survives later privacy switch",
    actor(43, "select follow_golfer(u(44));"),
    actor(44, "select set_account_private(true);"),
    "select test_assert(exists(select 1 from follows where follower_id=u(43) and following_id=u(44)) and (select is_private from profiles where id=u(44)),'accepted edge survives toggle ordering');");
  const cancelled = await request(45,46);
  await race("cancellation wins before acceptance",
    actor(45, "select cancel_follow_request(" + quoted(cancelled) + "::uuid);"),
    actor(46, "select test_denied(" + quoted("select respond_to_follow_request('" + cancelled + "',true)") + ",'cancelled race cannot accept');"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(45) and following_id=u(46)),'cancellation race has no edge');");
  const blocked = await request(47,48);
  await race("block wins before acceptance",
    actor(48, "insert into blocks values(u(48),u(47));"),
    actor(48, "select test_denied(" + quoted("select respond_to_follow_request('" + blocked + "',true)") + ",'blocked race cannot accept');"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(47) and following_id=u(48)),'block race has no edge');");
  const removed = await request(49,50);
  await race("remove waits for acceptance and revokes it",
    actor(50, "select respond_to_follow_request(" + quoted(removed) + "::uuid,true);"),
    actor(50, "select test_assert(remove_follower(u(49))->>'changed'='true','remove sees accepted edge');"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(49) and following_id=u(50)),'remove race leaves no edge');");
  await control.exec(transact(50, "select test_denied(" + quoted("select respond_to_follow_request('" + removed + "',true)") + ",'old accept cannot resurrect removed edge');"));
  await race("opposite-direction follows use common lock order",
    actor(51, "select follow_golfer(u(52));"),
    actor(52, "select follow_golfer(u(51));"),
    "select test_assert((select count(*)=2 from follows where follower_id in(u(51),u(52)) and following_id in(u(51),u(52))),'opposite follows both complete');");
  await control.exec("update profiles set is_private=true where id=u(56);");
  await race("duplicate requests share one generation",
    actor(55, "select follow_golfer(u(56));"),
    actor(55, "select test_assert(follow_golfer(u(56))->>'state'='pending','duplicate is pending');"),
    "select test_assert((select count(*)=1 from private.follow_requests where requester_id=u(55) and target_id=u(56) and status='pending') and (select count(*)=1 from notifications where user_id=u(56) and actor_id=u(55) and type='new_follow_request'),'one generation and one request notification');");
  const acceptedFirst = await request(57,58);
  await race("acceptance wins before cancellation",
    actor(58, "select respond_to_follow_request(" + quoted(acceptedFirst) + "::uuid,true);"),
    actor(57, "select test_assert(cancel_follow_request(" + quoted(acceptedFirst) + "::uuid)->>'changed'='false','late cancellation does not silently unfollow');"),
    "select test_assert(exists(select 1 from follows where follower_id=u(57) and following_id=u(58)) and (select status='accepted' from private.follow_requests where requester_id=u(57) and target_id=u(58)),'accepted race remains an accepted relationship');");
  await control.exec("update profiles set is_private=true where id=u(60);");
  await race("block wins before a new request",
    actor(60, "insert into blocks values(u(60),u(59));"),
    actor(59, "select test_denied('select follow_golfer(u(60))','new request rechecks committed block');"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(59) and following_id=u(60)) and not exists(select 1 from private.follow_requests where requester_id=u(59) and target_id=u(60) and status='pending'),'block prevents a new pending request');");
  await control.exec("delete from blocks where blocker_id=u(60) and blocked_id=u(59);");
  await race("new request wins first, then block cancels it",
    actor(59, "select test_assert(follow_golfer(u(60))->>'state'='pending','request initially pending');"),
    actor(60, "insert into blocks values(u(60),u(59));"),
    "select test_assert(not exists(select 1 from follows where follower_id=u(59) and following_id=u(60)) and (select status='cancelled' from private.follow_requests where requester_id=u(59) and target_id=u(60)),'later block cancels newly committed pending request');");
  process.stdout.write("PASS " + passed + " real concurrent-session scenarios. Synthetic database retained for inspection.\n");
} finally {
  a.close(); b.close(); control.close();
}
