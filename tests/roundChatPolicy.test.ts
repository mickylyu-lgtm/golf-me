// Run: npm run test:roundchat
// Static guard for the round_messages INSERT policy (no database here: the
// live check is the role-simulated SQL in the migration's header). Makes sure
// the newest definition across supabase/migrations is the "chat locks after
// the round" one, that it still carries every clause the previous policy
// enforced, and that its rollback snippet restores that previous policy
// verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const LOCK_FILE = "20261103120000_lock_round_chat_after_round.sql";
const BLOCKS_FILE = "20260924100300_enforce_blocks_on_rounds.sql";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// Executable statements only (comment lines dropped).
function code(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

function insertPolicies(sql: string): string[] {
  return [...code(sql).matchAll(/create policy round_messages_insert_member[\s\S]*?\);/g)].map((m) => squash(m[0]));
}

test("the newest round_messages insert policy is the lock-after-round one", () => {
  const withPolicy = files.filter((f) => insertPolicies(readFileSync(join(dir, f), "utf8")).length > 0);
  assert.equal(withPolicy[withPolicy.length - 1], LOCK_FILE);
});

test("it keeps sender, membership and the host block check, and adds the status rule", () => {
  const [policy] = insertPolicies(readFileSync(join(dir, LOCK_FILE), "utf8"));
  assert.ok(policy.includes("for insert to authenticated"));
  assert.ok(policy.includes("sender_id = (select auth.uid())"));
  assert.ok(policy.includes("private.is_round_member(round_id)"));
  assert.ok(policy.includes("not private.has_block_between( (select auth.uid()), (select gc.host_user_id from public.golf_calls gc where gc.id = round_id) )"));
  assert.ok(policy.includes("(select gc.status from public.golf_calls gc where gc.id = round_id) in ('open', 'full')"));
});

test("the rollback snippet recreates the previous policy exactly", () => {
  const previous = insertPolicies(readFileSync(join(dir, BLOCKS_FILE), "utf8"));
  assert.equal(previous.length, 1);
  const lockSql = readFileSync(join(dir, LOCK_FILE), "utf8");
  const rollback = lockSql
    .split("\n")
    .filter((l) => l.startsWith("--   "))
    .map((l) => l.slice(5))
    .join("\n");
  const restored = [...rollback.matchAll(/create policy round_messages_insert_member[\s\S]*?\);/g)].map((m) => squash(m[0]));
  assert.deepEqual(restored, previous);
});

test("the content-filter trigger on round_messages is not touched", () => {
  const lockCode = code(readFileSync(join(dir, LOCK_FILE), "utf8"));
  assert.ok(!/trigger/i.test(lockCode));
  assert.ok(!/select_member/.test(lockCode));
});
