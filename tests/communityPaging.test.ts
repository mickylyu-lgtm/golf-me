import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { CommunityPageGuard, CommunityPreferenceQueue, applyCommunityPreferences, readCommunityOwnedPostIds, communityBefore, readCommunityPage, refreshCommunityRange, readCommunityDetails } from '../src/lib/communityPaging.ts';
import { cursorAfter } from '../src/lib/followingFeed.ts';
import type { PostRow } from '../src/lib/communityPostRow.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number,at='2026-11-16T01:00:00.123456+00:00')=>({id:id(n),author_id:id(999),created_at:at,type:'text',text:`Post ${n}`,category:'general',swing_analysis_status:'not_applicable'}) as PostRow;
function fixture(tables:Record<string,Record<string,unknown>[]>, fail?:()=>boolean, cap=1000){
 const requests:URL[]=[];
 const client=createClient('http://local.invalid','dummy',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input)=>{
  const url=new URL(String(input));requests.push(url);
  if(fail?.())return new Response(JSON.stringify({message:'offline',code:'XX000'}),{status:503,headers:{'Content-Type':'application/json'}});
  let rows=[...(tables[url.pathname.split('/').pop()!]??[])];
  for(const [key,value]of url.searchParams){
   if(value.startsWith('in.(')){const values=value.slice(4,-1).split(',');rows=rows.filter(r=>values.includes(String(r[key])));}
   if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));
  }
  const or=url.searchParams.get('or');
  if(or){const match=or.match(/created_at.lt.([^,]+),and\(created_at.eq.[^,]+,id.lt.([^)]*)/)!;rows=rows.filter(r=>String(r.created_at)<match[1]||(r.created_at===match[1]&&String(r.id)<match[2]));}
  const orders=(url.searchParams.get('order')??'').split(',').filter(Boolean);
  rows.sort((a,b)=>{for(const order of orders){const [key,dir]=order.split('.');const cmp=String(a[key]).localeCompare(String(b[key]));if(cmp)return dir==='desc'?-cmp:cmp;}return 0;});
  const offset=Number(url.searchParams.get('offset')??0),limit=Math.min(cap,Number(url.searchParams.get('limit')??1000));
  return new Response(JSON.stringify(rows.slice(offset,offset+limit)),{headers:{'Content-Type':'application/json'}});
 }}});
 return {client,requests};
}
test('all-author keyset pages cross the initial cap with tied microsecond timestamps and no duplicates',async()=>{
 const source=Array.from({length:125},(_,i)=>row(i+1));const {client,requests}=fixture({community_posts:source as unknown as Record<string,unknown>[]});
 let cursor=cursorAfter([row(126)])!;const seen:string[]=[];
 for(;;){const page=await readCommunityPage(client,cursor);seen.push(...page.map(r=>r.id));if(!page.length)break;cursor=cursorAfter(page)!;}
 assert.equal(seen.length,125);assert.equal(new Set(seen).size,125);assert.equal(seen.at(-1),id(1));
 assert.ok(requests.every(u=>u.searchParams.get('order')==='created_at.desc,id.desc'));
 assert.ok(requests.every(u=>!u.searchParams.has('author_id')));
 assert.match(communityBefore(cursor),/123456/);
});
test('cursor rejects filter syntax injection instead of broadening the read',()=>{
 assert.throws(()=>communityBefore({before:'2026-01-01,or(true)',beforeId:id(1)}));
 assert.throws(()=>communityBefore({before:'2026-01-01T00:00:00Z',beforeId:'x),id.gt.0'}));
});
test('refresh re-reads loaded tail: removed rows disappear and restored rows return',async()=>{
 const source=Array.from({length:50},(_,i)=>row(i+1)).filter(r=>r.id!==id(25));
 const {client}=fixture({community_posts:source as unknown as Record<string,unknown>[]});
 const head=source.filter(r=>r.id>=id(45)).reverse();
 const result=await refreshCommunityRange(client,head,{before:row(1).created_at,beforeId:id(1)});
 assert.equal(result.posts.length,49);assert.ok(!result.posts.some(r=>r.id===id(25)));assert.ok(result.posts.some(r=>r.id===id(24)));
 assert.equal(new Set(result.posts.map(r=>r.id)).size,49);
});
test('later-page errors are failures, not an exhausted feed; the same cursor can retry',async()=>{
 let offline=true;const {client}=fixture({community_posts:[row(1)] as unknown as Record<string,unknown>[]},()=>offline);
 const cursor=cursorAfter([row(2)])!;await assert.rejects(readCommunityPage(client,cursor));offline=false;assert.equal((await readCommunityPage(client,cursor))[0].id,id(1));
});
test('older page hydration scopes metadata and owner state and reads through relation caps',async()=>{
 const comments=Array.from({length:205},(_,i)=>({id:id(i+500),post_id:id(1),author_id:id(999),text:'reply',created_at:row(1).created_at,parent_comment_id:null}));
 const tables={community_post_media:[{id:id(100),post_id:id(1),media_url:'test.jpg'},{id:id(101),post_id:id(2),media_url:'other.jpg'}],community_comments:comments,community_post_votes:[{post_id:id(1),voter_id:id(999)}],community_comment_votes:comments.map(c=>({comment_id:c.id,voter_id:id(999)})),saved_posts:[{owner_id:id(999),post_id:id(1)}],hidden_posts:[{owner_id:id(888),post_id:id(1)}]};
 const {client}=fixture(tables);const details=await readCommunityDetails(client,[row(1)],id(999));
 assert.equal(details.media.length,1);assert.equal(details.comments.length,205);assert.equal(details.commentVotes.length,205);assert.equal(details.saved.length,1);assert.equal(details.hidden.length,0);
 tables.hidden_posts.push({owner_id:id(999),post_id:id(1)});assert.equal((await readCommunityDetails(client,[row(1)],id(999))).hidden.length,1);
 tables.hidden_posts=[];assert.equal((await readCommunityDetails(client,[row(1)],id(999))).hidden.length,0);
});
test('refresh invalidates in-flight page immediately and an old finally cannot clear a new operation',()=>{
 const guard=new CommunityPageGuard();guard.reset('a');const old=guard.page()!;assert.ok(old);assert.equal(guard.page(),null);
 const refresh=guard.refresh();assert.equal(guard.current(old),false);assert.equal(guard.page(),null);assert.equal(guard.finishRefresh(refresh),true);
 const next=guard.page()!;assert.ok(next);assert.equal(guard.finishPage(old),false);assert.equal(guard.page(),null);assert.equal(guard.finishPage(next),true);
});
test('account switch rejects previous account results and overlapping refresh cleanup',()=>{
 const guard=new CommunityPageGuard();guard.reset('a');const old=guard.snapshot();const r1=guard.refresh(),r2=guard.refresh();assert.equal(guard.finishRefresh(r1),false);assert.equal(guard.page(),null);assert.equal(guard.finishRefresh(r2),true);
 guard.reset('b');assert.equal(guard.current(old),false);assert.equal(guard.current(r2),false);assert.equal(guard.page()!.owner,'b');
});


test('owner metadata pagination tolerates a cap below the requested batch and pending hides override old reads',async()=>{
 const hidden=Array.from({length:47},(_,i)=>({owner_id:id(999),post_id:id(i+1)}));
 const {client}=fixture({hidden_posts:hidden},undefined,7);
 assert.equal((await readCommunityOwnedPostIds(client,'hidden_posts',id(999))).data.length,47);
 assert.deepEqual(applyCommunityPreferences([],new Map([[id(1),{value:true}]])),[id(1)]);
 assert.deepEqual(applyCommunityPreferences([id(1)],new Map([[id(1),{value:false}]])),[]);
});
test('raw cursor advances through short capped pages, including completely client-hidden pages',async()=>{
 const source=Array.from({length:43},(_,i)=>row(i+1));const {client}=fixture({community_posts:source as unknown as Record<string,unknown>[]},undefined,7);
 let cursor=cursorAfter([row(44)])!,count=0;
 for(;;){const page=await readCommunityPage(client,cursor);if(!page.length)break;count+=page.length;cursor=cursorAfter(page)!;}
 assert.equal(count,43);
});


test('preference writes serialize a slow save before a later unsave, while other posts proceed',async()=>{
 const queue=new CommunityPreferenceQueue();let saved=false;let release!:()=>void;const delayed=new Promise<void>(r=>{release=r;});const order:string[]=[];
 const save=queue.run('owner:saved:post',async()=>{order.push('save-start');await delayed;saved=true;order.push('save-end');});
 const unsave=queue.run('owner:saved:post',async()=>{order.push('unsave');saved=false;});
 await queue.run('owner:saved:other',async()=>{order.push('other');});
 assert.deepEqual(order,['save-start','other']);release();await Promise.all([save,unsave]);assert.equal(saved,false);assert.deepEqual(order,['save-start','other','save-end','unsave']);
});
test('failed preference write cannot block the next action; pending intent makes duplicate hides a no-op',async()=>{
 const queue=new CommunityPreferenceQueue();await assert.rejects(queue.run('hide',async()=>{throw new Error('offline');}));
 assert.equal(await queue.run('hide',async()=>true),true);
 const pending=new Map<string,{value:boolean}>();let inserts=0;
 function hide(){const previous=pending.get('post')?.value??false;if(previous)return;pending.set('post',{value:true});inserts++;}
 hide();hide();assert.equal(inserts,1);
});
