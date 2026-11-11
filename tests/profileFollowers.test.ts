import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectVisibleFollowers, parseFollowerPage, filterProfileFollowers, requireCurrentFollowerRead } from "../src/lib/profileFollowers.ts";
import type { GolferProfile } from "../src/types/index.ts";
const golfers = [{ id: "a", name: "Alex Green", username: "alex" }, { id: "b", name: "Bea Park", username: "bea" }, { id: "c", name: "Cam Hill", username: "cam" }] as GolferProfile[];
const follows = (id: string) => id !== "a";
const blocked = (id: string) => id === "c";
const row = (id: string, is_mutual = false) => ({ id, name: `Fixture ${id}`, is_mutual, handicap: null, member_since: "2026-01-01T00:00:00Z" });
const response = (followers: unknown[], total = followers.length, mutual_total = 0) => ({ version: 1, total, mutual_total, followers });

test("followers exclude blocked profiles; mutuals are viewer-followed followers", () => {
  assert.deepEqual(filterProfileFollowers(golfers, "", false, follows, blocked).map((g) => g.id), ["a", "b"]);
  assert.deepEqual(filterProfileFollowers(golfers, "", true, follows, blocked).map((g) => g.id), ["b"]);
});
test("search supports name, username, whitespace and @ prefix", () => {
  assert.equal(filterProfileFollowers(golfers, " GREEN ", false, follows, blocked)[0]?.id, "a");
  assert.equal(filterProfileFollowers(golfers, "@BeA", true, follows, blocked)[0]?.id, "b");
  assert.deepEqual(filterProfileFollowers(golfers, "cam", false, follows, blocked), []);
  assert.deepEqual(filterProfileFollowers(golfers, "unknown", false, follows, blocked), []);
});
test("the endpoint contract parses only versioned, consistent identity pages", () => {
  const parsed = parseFollowerPage(response([row("a", true), row("b")], 2, 1));
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.mutualIds, ["a"]);
  for (const raw of [null, {}, { ...response([]), version: 0 }, response([], -1), response([], 1, 2), response([row("a"), row("a")]), response([{id:"a",name:"  ",is_mutual:false}]), response([row("a",true)],1,0)]) {
    assert.throws(() => parseFollowerPage(raw));
  }
  assert.equal(parseFollowerPage(response([], 9, 3)).total, 9, "count-only calls retain filtered totals");
});
test("authorized pagination crosses API caps without truncating mutuals", async () => {
  const source = Array.from({ length: 1234 }, (_, i) => row(`g${i}`, i % 2 === 0));
  const offsets: number[] = [];
  const result = await collectVisibleFollowers(async (offset, size) => {
    offsets.push(offset);
    return parseFollowerPage(response(source.slice(offset, offset + size), 1234, 617));
  });
  assert.equal(result.total, 1234);
  assert.equal(result.golfers.length, 1234);
  assert.equal(result.mutualIds.length, 617);
  assert.equal(result.golfers.at(-1)?.id, "g1233");
  assert.equal(offsets.at(-1), 1200);
});
test("empty and exact-boundary pages finish correctly", async () => {
  const empty = await collectVisibleFollowers(async () => parseFollowerPage(response([])));
  assert.equal(empty.total, 0);
  let reads = 0;
  const full = await collectVisibleFollowers(async () => { reads++; return parseFollowerPage(response(Array.from({length:100}, (_, i) => row(String(i))),100)); });
  assert.equal(full.total, 100);
  assert.equal(reads, 1);
});
test("errors, changing totals, duplicate pages and incomplete lists fail closed", async () => {
  const first = parseFollowerPage(response(Array.from({length:100},(_,i)=>row(String(i))),101));
  await assert.rejects(collectVisibleFollowers(async () => { throw new Error("permission denied"); }), /permission denied/);
  await assert.rejects(collectVisibleFollowers(async (offset) => offset ? parseFollowerPage(response([row("100")],102)) : first), /changed/);
  await assert.rejects(collectVisibleFollowers(async (offset) => offset ? parseFollowerPage(response([row("0")],101)) : first), /changed/);
  await assert.rejects(collectVisibleFollowers(async () => parseFollowerPage(response([row("a")],2))), /changed/);
});
test("followers client has no raw relationship or broad profile fallback", () => {
  const source = readFileSync(new URL("../src/lib/profileFollowersFetch.ts", import.meta.url), "utf8");
  assert.match(source, /supabase\.rpc\(FOLLOWERS_RPC/);
  assert.doesNotMatch(source, /supabase\.from|fetchPublicProfiles|golfer_public_profiles/);
});
test("SQL declares mandatory exclusions and restricted execute grants", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261111010730_profile_followers_visibility.sql", import.meta.url), "utf8");
  for (const fragment of ["and p.has_onboarded", "and not private.is_directory_excluded(p.id)", "and not private.is_suspended(p.id)", "and not private.has_block_between(p_viewer, p.id)", "and not private.has_block_between(p_profile_id, f.follower_id)", "with eligible as materialized", "from eligible where is_mutual", "revoke all on function private.can_list_follower_profile(uuid, uuid) from public, anon, authenticated, service_role", "revoke all on function public.golfer_profile_followers(uuid, integer, integer) from public, anon, authenticated, service_role"]) assert.ok(sql.includes(fragment),fragment);
  assert.doesNotMatch(sql, /grant.*(?:private\.user_suspensions|public\.follows)/i);
});

test("late follower read is rejected after unfollow, block or account change", async () => {
  for (const change of ["follows", "blocks", "viewer"] as const) {
    let scope = { follows: ["hidden-direct-contact"], blocks: [] as string[], viewer: "viewer-a" };
    const snapshot = scope;
    let finish!: (value: string[]) => void;
    const pending = requireCurrentFollowerRead(new Promise<string[]>((resolve) => { finish = resolve; }), () => scope === snapshot);
    scope = { ...scope, [change]: change === "viewer" ? "viewer-b" : [] };
    finish(["hidden-direct-contact"]);
    await assert.rejects(pending, /visibility changed/);
  }
});
test("follow changes invalidate live counts and open-sheet fetch callbacks", () => {
  const source = readFileSync(new URL("../src/context/RealSocialContext.tsx", import.meta.url), "utf8");
  assert.match(source, /followerPrivacyRef\.current\.follows !== follows/);
  assert.equal((source.match(/\[selfId, blocks, follows, socialRevision, isBlocked, isBlockedBy\]/g) ?? []).length, 4);
  assert.match(source, /requireCurrentFollowerRead\(fetchConnections/);
});
