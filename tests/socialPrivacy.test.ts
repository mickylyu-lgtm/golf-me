import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFollowState, parseConnections, collectConnections, parseFollowRequests, parsePrivacySetting, requireChangedResponse, requireRequestResponse } from "../src/lib/socialPrivacy.ts";
import { demoConnections, demoFollowState, demoIncomingRequests } from "../src/lib/demoSocialPrivacy.ts";
import type { AppData, GolferProfile } from "../src/types/index.ts";
const row = (id: string, is_mutual = false) => ({ id, name: "Fixture " + id, is_mutual });
const page = (profiles: unknown[], total = profiles.length, mutual_total = 0, kind = "followers") => ({ version: 1, kind, total, mutual_total, profiles });
const state = (state = "none", request_id: string | null = null, is_private = true, can_view_connections = false) => ({ version: 1, state, request_id, is_private, can_view_connections });
function demo(): AppData {
  return {
    golfers: ["viewer", "owner", "mutual", "other", "blocked"].map((id) => ({ id, name: id })) as GolferProfile[],
    follows: [["viewer", "owner"], ["viewer", "mutual"], ["mutual", "owner"], ["other", "owner"], ["owner", "other"], ["blocked", "owner"]].map(([followerId, followingId], i) => ({ id: String(i), followerId, followingId, createdAt: "2026-01-01" })),
    blocks: [{ blockerId: "blocked", blockedId: "viewer", createdAt: "2026-01-01" }], currentUserId: "viewer",
    privateFollowProfiles: { owner: true },
    followRequests: [{ id: "pending", followerId: "other", followingId: "viewer", createdAt: "2026-01-01" }],
  } as AppData;
}
test("pending follow is never accepted; malformed state fails closed", () => {
  assert.equal(parseFollowState(state("pending", "r")).canViewConnections, false);
  assert.equal(parseFollowState(state("following", null, true, true)).state, "following");
  assert.equal(parseFollowState(state("none", null, true, true)).canViewConnections, true, "self can see connections");
  for (const raw of [null, {}, state("accepted"), state("pending"), state("none", "r"), { ...state(), is_private: null }]) assert.throws(() => parseFollowState(raw));
});
test("connections parser checks kind, shape, totals and duplicate identities", () => {
  assert.equal(parseConnections(page([row("a")], 1, 7, "following"), "following").mutualTotal, 7, "mutual summary is unrelated to following total");
  for (const raw of [page([], -1), page([row("a"), row("a")]), page([{id:"a",name:"  ",is_mutual:false}]), page([{id:"a",name:"A"}]), page([], 0, -1), { ...page([]), version: 2 }, page([], 0, 0, "following")]) assert.throws(() => parseConnections(raw, "followers"));
});
test("connections pagination returns all rows and rejects partial or mixed snapshots", async () => {
  const rows = Array.from({length: 203}, (_, i) => row(String(i)));
  const result = await collectConnections(async (offset) => parseConnections(page(rows.slice(offset,offset+100),203,4), "followers"));
  assert.equal(result.total, 203); assert.equal(result.mutualTotal, 4);
  await assert.rejects(collectConnections(async () => parseConnections(page(rows.slice(0,1),203), "followers")), /changed/);
  await assert.rejects(collectConnections(async (offset) => parseConnections(page(offset ? [row("0")] : rows.slice(0,100),101), "followers")), /changed/);
  await assert.rejects(collectConnections(async (offset) => parseConnections(page(rows.slice(offset,offset+100),203,offset ? 3 : 4), "followers")), /changed/);
});
test("requests and write responses cannot fabricate successful state", () => {
  assert.equal(parseFollowRequests({version:1,total:1,requests:[{request_id:"r",created_at:"2026-01-01",profile:row("a")}]}).requests[0].golfer.id,"a");
  for (const raw of [null, {version:1,total:1,requests:[{request_id:"r",created_at:"now",profile:null}]}, {version:1,total:0,requests:[{}]}]) assert.throws(() => parseFollowRequests(raw));
  assert.equal(parsePrivacySetting({version:1,is_private:true}),true);
  assert.throws(() => parsePrivacySetting({version:1,is_private:"true"}));
  assert.throws(() => requireChangedResponse({version:1}));
  requireChangedResponse({version:1,changed:false});
  requireRequestResponse({version:1,state:"accepted"},true);
  assert.throws(() => requireRequestResponse({version:1,state:"rejected"},true));
});
test("demo permits nonfollowers and pending viewers in both directions", () => {
  const data=demo();
  assert.equal(demoConnections(data,"viewer","owner","followers").total,3);
  assert.equal(demoConnections(data,"viewer","owner","followers").mutualTotal,1);
  assert.deepEqual(demoConnections(data,"viewer","owner","following").golfers.map(g=>g.id),["other"]);
  for(const kind of ["followers","following"] as const) {
    assert.doesNotThrow(()=>demoConnections(data,"other","viewer",kind));
    assert.doesNotThrow(()=>demoConnections(data,"owner","owner",kind));
  }
  assert.equal(demoFollowState(data,"other","viewer").state,"pending");
  assert.equal(demoFollowState(data,"other","viewer").canViewConnections,true);
});
test("demo public access survives privacy toggle and unfollow but not blocks", () => {
  const data=demo();
  data.privateFollowProfiles={owner:false};
  assert.equal(demoConnections(data,"viewer","owner","followers").mutualTotal,1);
  data.privateFollowProfiles={owner:true};
  assert.equal(demoConnections(data,"viewer","owner","followers").mutualTotal,1);
  const removed={...data,follows:data.follows.filter(f=>!(f.followerId==="viewer"&&f.followingId==="owner"))};
  assert.equal(demoConnections(removed,"viewer","owner","followers").total,2);
  for(const [blockerId,blockedId] of [["owner","viewer"],["viewer","owner"]]) {
    assert.throws(()=>demoConnections({...data,blocks:[{blockerId,blockedId,createdAt:"now"}]},"viewer","owner","following"));
  }
});
test("demo requests exclude blocks and are owner-scoped", () => {
  const data=demo();
  assert.equal(demoIncomingRequests(data,"viewer").length,1);
  assert.equal(demoIncomingRequests(data,"owner").length,0);
  data.blocks.push({blockerId:"other",blockedId:"viewer",createdAt:"now"});
  assert.equal(demoIncomingRequests(data,"viewer").length,0);
});
test("client mutations use dedicated RPCs and never raw insert/privacy fallback", () => {
  const fetch=readFileSync(new URL("../src/lib/socialPrivacyFetch.ts",import.meta.url),"utf8");
  for(const rpc of ["golfer_profile_connections","golfer_follow_state","follow_golfer","unfollow_golfer","remove_follower","cancel_follow_request","respond_to_follow_request","set_account_private","my_follow_requests"]) assert.ok(fetch.includes('"' + rpc + '"'),rpc);
  assert.doesNotMatch(fetch,/supabase\.from|fetchPublicProfiles/);
  const source=readFileSync(new URL("../src/context/RealSocialContext.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/from\("follows"\)\.insert/);
  assert.match(source,/socialVersion === socialMutationVersion.current && socialWrites.current.size === 0/);
  assert.doesNotMatch(source,/setFollows\(previous\)/);
});
test("render-time snapshots never reuse cached private rows across read scope changes", () => {
  const source=readFileSync(new URL("../src/lib/useSocialRead.ts",import.meta.url),"utf8");
  assert.match(source,/enabled && result\?\.scope === scope/);
  assert.match(source,/scopeRef.current.enabled !== enabled/);
  const ui=readFileSync(new URL("../src/components/profile/ProfileFollowers.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/followers\.mutuals|mutualsOnly/);
  assert.match(ui,/\["followers", "following"\]/);
  assert.match(ui,/own && kind === "followers"/);
});

test("demo saves retain approval settings, requests and retry cooldowns on reload", () => {
  const source=readFileSync(new URL("../src/lib/storage.ts",import.meta.url),"utf8");
  for(const field of ["privateFollowProfiles","followRequests","closedFollowRequests"]) assert.ok(source.includes(field + ": parsed." + field),field);
});
test("uncertain mutations refresh authoritative state rather than display old success", () => {
  for(const [path,fragment] of [
    ["FollowApprovalSetting.tsx","catch { setSaveFailed(true); retry(); }"],
    ["FollowRequests.tsx","catch { setActionFailed(true); retry(); }"],
    ["ProfileFollowers.tsx","catch { setRemoving(null); setRemoveFailed(true); retry(); retryTotals(); }"],
  ]) assert.ok(readFileSync(new URL("../src/components/profile/"+path,import.meta.url),"utf8").includes(fragment),path);
});
test("all six locale dictionaries include follow approval, requests, removal and summary copy", () => {
  for(const locale of ["en","es","ja","ko","zh-CN","zh-TW"]) {
    const source=readFileSync(new URL("../src/i18n/locales/"+locale+".ts",import.meta.url),"utf8");
    for(const key of ["socialPrivacy.description","socialPrivacy.requests","socialPrivacy.cancelRequest","followers.removeExplanation","followers.mutualSummary","followers.following"]) assert.ok(source.includes('"' + key + '"'),locale+":"+key);
  }
});
