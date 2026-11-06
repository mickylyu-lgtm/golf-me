// Run: npm run test:trust  (node --test, built-in type stripping)
// Verified Golfer badge (migration 20261107230000_verified_golfer_derived):
// the client's row shaping, the demo mirror of the rule, feature detection,
// and a static guard on the migration itself (the live checks are the PGlite
// suite in the scratchpad, pglite/_verified_badge.mjs, and verified-badge-check.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checklistFromRow, demoChecklist, hasProfilePhoto, isMissingVerifiedGolferRpc } from "../src/lib/verifiedGolfer.ts";

test("row -> checklist: only true counts; a missing row is null", () => {
  assert.equal(checklistFromRow(null), null);
  assert.equal(checklistFromRow(undefined), null);
  assert.deepEqual(checklistFromRow({ verified: true, identity_confirmed: true, has_photo: true, has_qualifying_round: true }), {
    verified: true,
    identityConfirmed: true,
    hasPhoto: true,
    hasQualifyingRound: true,
  });
  assert.deepEqual(checklistFromRow({ verified: null, identity_confirmed: null, has_photo: false, has_qualifying_round: null }), {
    verified: false,
    identityConfirmed: false,
    hasPhoto: false,
    hasQualifyingRound: false,
  });
});

test("demo mirror: all three criteria, nothing about a phone", () => {
  assert.equal(demoChecklist({ emailVerified: true, photoUrl: "x.jpg", qualifyingRounds: 1 }).verified, true);
  assert.equal(demoChecklist({ emailVerified: false, photoUrl: "x.jpg", qualifyingRounds: 3 }).verified, false);
  assert.equal(demoChecklist({ emailVerified: true, photoUrl: "  ", qualifyingRounds: 3 }).verified, false);
  assert.equal(demoChecklist({ emailVerified: true, photoUrl: undefined, qualifyingRounds: 3 }).verified, false);
  assert.equal(demoChecklist({ emailVerified: true, photoUrl: "x.jpg", qualifyingRounds: 0 }).verified, false);
  assert.equal(hasProfilePhoto(null), false);
  assert.equal(hasProfilePhoto("https://a/b.jpg"), true);
});

test("feature detection: missing RPC vs. a transient failure", () => {
  assert.equal(isMissingVerifiedGolferRpc({ code: "PGRST202", message: "Could not find the function public.get_my_verified_golfer_status" }), true);
  assert.equal(isMissingVerifiedGolferRpc({ code: "42883", message: "function public.get_my_verified_golfer_status() does not exist" }), true);
  assert.equal(isMissingVerifiedGolferRpc({ code: "", message: "TypeError: Failed to fetch" }), false);
  assert.equal(isMissingVerifiedGolferRpc({ code: "42501", message: "Not signed in." }), false);
  assert.equal(isMissingVerifiedGolferRpc(null), false);
});

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const name = "20261107230000_verified_golfer_derived.sql";
const sql = readFileSync(join(dir, name), "utf8");
const code = sql.replace(/--.*$/gm, "");

test("migration: numbered after every earlier one", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes(name));
});

test("migration: every function SECURITY DEFINER with search_path ''", () => {
  const fns = code.split(/create or replace function /i).slice(1);
  assert.ok(fns.length >= 10, `found ${fns.length}`);
  for (const fn of fns) {
    const head = fn.slice(0, fn.indexOf("$$"));
    assert.match(head, /security definer/i, head.split("\n")[0]);
    assert.match(head, /set search_path = ''/i, head.split("\n")[0]);
  }
});

test("migration: reuses the frozen qualifying-round definition, never redefines it", () => {
  assert.match(code, /public\.get_reputation_state\(p_user_id\)/);
  assert.doesNotMatch(code, /create or replace function public\.get_reputation_state/i);
  assert.doesNotMatch(code, /joined_n/);
});

test("migration: private helpers revoked, only the own-checklist RPC granted", () => {
  for (const fn of ["verified_identity_confirmed", "has_qualifying_round", "verified_golfer_checks", "is_verified_golfer", "refresh_verified_golfer"]) {
    assert.match(code, new RegExp(`revoke execute on function private\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), fn);
  }
  assert.doesNotMatch(code, /grant execute on function private\./i);
  assert.match(code, /grant execute on function public\.get_my_verified_golfer_status\(\) to authenticated;/);
  assert.match(code, /revoke execute on function public\.get_my_verified_golfer_status\(\) from public, anon;/);
  // The RPC takes no argument: it can only ever describe the caller.
  assert.match(code, /function public\.get_my_verified_golfer_status\(\)\s*\n\s*returns table \(verified boolean, identity_confirmed boolean, has_photo boolean, has_qualifying_round boolean\)/);
});

test("migration: the badge never follows a client-sent value", () => {
  // update path: start from the stored value, only a recompute may change it
  assert.match(code, /new\.verified_golfer := old\.verified_golfer;\s*\n\s*if new\.photo_url is distinct from old\.photo_url/);
  // insert path: start false, then derive
  assert.match(code, /new\.verified_golfer := false;\s*\n\s*begin\s*\n\s*new\.verified_golfer := private\.is_verified_golfer\(new\.id, new\.photo_url\);/);
});
