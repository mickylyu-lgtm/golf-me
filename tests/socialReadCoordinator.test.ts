import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocialReadCoordinator, requireSocialScope } from "../src/lib/socialReadCoordinator.ts";
import { requireCurrentFollowerRead } from "../src/lib/profileFollowers.ts";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("in-flight summaries deduplicate within scope but never cache settled values", async () => {
  const reads=createSocialReadCoordinator();const scope={};let count=0;let resolve!: (n:number)=>void;
  const read=()=>{count++;return new Promise<number>(r=>resolve=r);};
  const a=reads.deduplicate(scope,"summary",read),b=reads.deduplicate(scope,"summary",read);
  assert.equal(a,b);await tick();assert.equal(count,1);resolve(3);assert.equal(await a,3);
  const c=reads.deduplicate(scope,"summary",async()=>++count);assert.equal(await c,2);
  await reads.deduplicate({},"summary",async()=>++count);assert.equal(count,3);
});
test("failed reads clear in-flight entries", async()=>{
 const reads=createSocialReadCoordinator();const scope={};
 await assert.rejects(reads.deduplicate(scope,"a",async()=>{throw Error("denied");}));
 assert.equal(await reads.deduplicate(scope,"a",async()=>1),1);
});
test("row requests cap concurrency across scopes and skip stale queued reads", async()=>{
 const reads=createSocialReadCoordinator(2);let current=true;let started=0;const release: (()=>void)[]=[];
 const promises=Array.from({length:8},()=>reads.limit(async()=>{started++;await new Promise<void>(r=>release.push(r));return 1;},()=>current));
 // Attach rejection handlers before invalidating queued work.
 const settled=Promise.allSettled(promises);
 await tick();assert.equal(started,2);current=false;
 const fresh=reads.limit(async()=>{started++;return 9;},()=>true);
 release.forEach(r=>r());await settled;assert.equal(await fresh,9);assert.equal(started,3);
});
test("caller scope recheck prevents cache write after helper validation microtask", async()=>{
 let current=true;let wrote=false;let resolve!: (n:number)=>void;
 const response=new Promise<number>(r=>resolve=r);
 const checked=requireCurrentFollowerRead(response,()=>current);
 const outer=(async()=>{await checked;requireSocialScope(()=>current);wrote=true;})();
 resolve(1);
 // Helper's continuation runs first, then this mutation, then caller's continuation.
 queueMicrotask(()=>{current=false;});
 await assert.rejects(outer,/visibility changed/);assert.equal(wrote,false);
});
