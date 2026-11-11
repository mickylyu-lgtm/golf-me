import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConnectionPage, appendConnectionPage, parseFollowState } from "../src/lib/socialPrivacy.ts";
import { demoConnectionPage } from "../src/lib/demoSocialPrivacy.ts";
import type { AppData } from "../src/types/index.ts";
const row = (id: string) => ({id,name:id,is_mutual:false,email:"DO NOT EXPOSE",phone:"SECRET"});
const page = (ids: string[], cursor: unknown = null) => ({version:2,kind:"followers",total:70,matched_total:70,mutual_total:0,profiles:ids.map(row),next_cursor:cursor});
test("bounded public pages validate version, counts, cursor and public allowlist", () => {
  const parsed = parseConnectionPage(page(["a"],{id:"a"}),"followers");
  assert.equal(parsed.golfers.length,1);
  assert.ok(!JSON.stringify(parsed).includes("DO NOT EXPOSE"));
  assert.ok(!JSON.stringify(parsed).includes("SECRET"));
  for(const value of [{...page([]),version:1},{...page([]),matched_total:71},page([],{id:"bad"}),page(["a"],[]),page(["a","a"])]) assert.throws(()=>parseConnectionPage(value,"followers"));
});
test("append rejects duplicate and stalled cursors; changed counts are authoritative", () => {
  const first=parseConnectionPage(page(["a"],{id:"a"}),"followers");
  assert.throws(()=>appendConnectionPage(first,parseConnectionPage(page(["a"]),"followers")));
  assert.throws(()=>appendConnectionPage(first,parseConnectionPage(page(["b"],{id:"a"}),"followers")));
  const next=appendConnectionPage(first,parseConnectionPage({...page(["b"]),total:2,matched_total:2},"followers"));
  assert.deepEqual(next.golfers.map(g=>g.id),["a","b"]); assert.equal(next.total,2);
});
test("public pending visibility never implies an accepted following", () => {
  const state=parseFollowState({version:1,state:"pending",request_id:"r",is_private:true,can_view_connections:true});
  assert.equal(state.state,"pending");assert.equal(state.canViewConnections,true);
});
test("demo pages bound results and search separate fields literally", () => {
  const golfers=[{id:"viewer",name:"Viewer"},{id:"owner",name:"Owner"},...Array.from({length:65},(_,i)=>({id:String(i).padStart(3,"0"),name:"Name "+i,username:"user"+i}))];
  const data={golfers,blocks:[],follows:golfers.slice(2).map(g=>({followerId:g.id,followingId:"owner"}))} as unknown as AppData;
  const first=demoConnectionPage(data,"viewer","owner","followers","",null);
  assert.equal(first.golfers.length,30);assert.equal(first.total,65);
  const next=demoConnectionPage(data,"viewer","owner","followers","",first.nextCursor);
  assert.equal(next.golfers.length,30);assert.ok(!first.golfers.some(g=>next.golfers.some(n=>n.id===g.id)));
  assert.equal(demoConnectionPage(data,"viewer","owner","followers","0 user",null).matchedTotal,0);
  assert.equal(demoConnectionPage(data,"viewer","owner","followers","@user",null).matchedTotal,0);
});
test("UI uses bounded server search and does not restore accepted-follower gates", () => {
  const ui=readFileSync(new URL("../src/components/profile/ProfileFollowers.tsx",import.meta.url),"utf8");
  assert.match(ui,/useConnectionPages/);assert.doesNotMatch(ui,/getProfileConnections|permitted =[^\n]*isFollowing\(profileId\)/);
  assert.match(ui,/<FollowControl profileId=\{golfer.id\}/);
  const network=readFileSync(new URL("../src/lib/socialPrivacyFetch.ts",import.meta.url),"utf8");
  assert.match(network,/p_limit: 30, p_search: search, p_cursor: cursor/);
});

test("page rows populate public navigation cache only after current-scope validation", () => {
  const source=readFileSync(new URL("../src/context/RealSocialContext.tsx",import.meta.url),"utf8");
  const pageRead=source.slice(source.indexOf("const getConnectionPage ="),source.indexOf("const getProfileConnections ="));
  assert.ok(pageRead.indexOf("await requireCurrentFollowerRead") < pageRead.indexOf("cache.set(golfer.id, golfer)"));
  assert.match(pageRead,/setProfileCache/);
});

test("searchable followers sheet opts into existing body-resize keyboard handling", () => {
 const ui=readFileSync(new URL("../src/components/profile/ProfileFollowers.tsx",import.meta.url),"utf8");
 assert.match(ui,/<SearchModal title=\{t\("followers.connectionsTitle"\)\}/);
 const modal=readFileSync(new URL("../src/components/ui/Modal.tsx",import.meta.url),"utf8");
 assert.match(modal,/useKeyboardHeight\(\)/);assert.match(modal,/lockPageScroll\(\)/);
 assert.match(modal,/scrollTopBeforeKeyboardRef/);
});
