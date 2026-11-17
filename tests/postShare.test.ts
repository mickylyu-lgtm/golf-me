import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPostShare, isShareablePostId } from "../src/lib/postShare.ts";
import { isAllowedReturnPath, saveReturnTo, peekReturnTo, clearReturnTo } from "../src/lib/returnTo.ts";
import { readFileSync } from "node:fs";
const id = "3f1c2a9e-8b7d-4c6e-9a51-0d2e4f6a8b10";
test("post share is canonical and contains only generic copy and an opaque id", () => {
 assert.deepEqual(buildPostShare(id, {title:"GolfMe community",text:"View this post on GolfMe."}), {
 title:"GolfMe community",text:"View this post on GolfMe.",url:`https://golfme.app/community/${id}`});
 for (const invalid of ["demo-1", "", "../settings", `${id}?token=secret`, `https://evil.test/${id}`]) {
 assert.equal(isShareablePostId(invalid),false); assert.equal(buildPostShare(invalid,{title:"x",text:"x"}),null);
 }
});
test("post auth return allows only exact UUID detail paths", () => {
 assert.equal(isAllowedReturnPath(`/community/${id}`),true);
 for (const path of ["/community/new", "/community", "/community/guidelines", `//evil.test/community/${id}`,`/community/${id}?next=https://evil.test`,`/community/${id}/more`]) assert.equal(isAllowedReturnPath(path),false);
});
test("same-browser post destination survives sign-in, clears on arrival, expires", () => {
 const values = new Map<string,string>();
 const original = Object.getOwnPropertyDescriptor(globalThis,"window");
 Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}}});
 try {
 saveReturnTo(`/community/${id}`); assert.equal(peekReturnTo(),`/community/${id}`);
 saveReturnTo("/login"); assert.equal(peekReturnTo(),`/community/${id}`);
 clearReturnTo(); assert.equal(peekReturnTo(),null);
 values.set("golfme:returnTo",JSON.stringify({path:`/community/${id}`,savedAt:Date.now()-86400001})); assert.equal(peekReturnTo(),null);
 } finally { if(original) Object.defineProperty(globalThis,"window",original); else Reflect.deleteProperty(globalThis,"window"); }
});
test("detail filters the whole page through existing feed visibility", () => {
 const src=readFileSync(new URL("../src/pages/PostDetail.tsx",import.meta.url),"utf8");
 assert.ok(src.includes("visiblePosts().some((p) => p.id === candidate.id)"));
 assert.ok(src.indexOf("if (!post)") < src.indexOf("<PostCard"));
});
test("share button isolates navigation, prevents repeats, respects cancellation",()=>{
 const src=readFileSync(new URL("../src/components/community/PostShareButton.tsx",import.meta.url),"utf8");
 assert.ok(src.includes("e.stopPropagation()")); assert.ok(src.includes("if (busy.current) return"));
 assert.ok(src.includes('outcome === "copied"')); assert.ok(src.includes('outcome === "failed"'));
 assert.equal(src.includes('outcome === "cancelled"'),false);
});

test("targeted post lookup uses only ordinary RLS-filtered reads and fails closed", async () => {
 const { readSharedCommunityPost } = await import("../src/lib/sharedCommunityPost.ts");
 const calls: unknown[]=[];
 const makeClient=(data:unknown,error:unknown=null)=>({from:(table:string)=>{calls.push(table);return {select:(fields:string)=>{calls.push(fields);return {eq:(field:string,value:string)=>{calls.push([field,value]);return {maybeSingle:async()=>({data,error})};}};}};}});
 const row={id,author_id:"author",text:"authorized old post"};
 assert.deepEqual(await readSharedCommunityPost(makeClient(row) as never,id),row);
 assert.deepEqual(calls,["community_posts","*",["id",id]]);
 for (const _reason of ["blocked","deleted","private","missing"]) assert.equal(await readSharedCommunityPost(makeClient(null) as never,id),null);
 await assert.rejects(readSharedCommunityPost(makeClient(null,new Error("offline")) as never,id),/offline/);
 calls.length=0;assert.equal(await readSharedCommunityPost(makeClient(row) as never,"invalid"),null);assert.deepEqual(calls,[]);
});


test("post share is icon-only with an accessible name and 44px target", () => {
 const src = readFileSync(new URL("../src/components/community/PostShareButton.tsx", import.meta.url), "utf8");
 assert.ok(src.includes('aria-label={t("share.sharePost")}'));
 assert.ok(src.includes('min-h-11 min-w-11'));
 assert.match(src, /<Share2 size=\{13\} aria-hidden="true" \/>\s*<\/button>/);
});

test("share icon sits directly after the bookmark in the same action row", () => {
 const src = readFileSync(new URL("../src/components/community/PostCard.tsx", import.meta.url), "utf8");
 assert.match(src, /<Bookmark[^]*?<\/button>\s*<PostShareButton postId=\{post.id\} \/>/);
 assert.equal((src.match(/<PostShareButton/g) ?? []).length, 1);
 const button = readFileSync(new URL("../src/components/community/PostShareButton.tsx", import.meta.url), "utf8");
 assert.equal(button.includes("border-fairway"), false);
 assert.equal(button.includes("bg-fairway"), false);
});
