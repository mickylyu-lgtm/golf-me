import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suspensionUntil } from "../src/lib/moderation.ts";
const dialog = readFileSync(new URL('../src/components/moderation/SuspendUserDialog.tsx', import.meta.url), 'utf8');
function harness({confirmed=true, problem=null, fails=false, rpcError=null,status=200}: {confirmed?:boolean;problem?:string|null;fails?:boolean;rpcError?:{message:string}|null;status?:number}={}) {
  const source=dialog.slice(dialog.indexOf('  async function submit()'),dialog.indexOf('\n  return ('));
  const calls: unknown[]=[]; const errors: unknown[]=[]; let success=0; let unknown=false;
  let finish!:()=>void; const wait=new Promise<void>(r=>finish=r);
  const deps={outcomeUnknown:false,setOutcomeUnknown:(v:boolean)=>{unknown=v},submitting:{current:false},problem,ban:true,confirmed,setBusy:()=>{},setError:(e:unknown)=>errors.push(e),supabase:{rpc:async (...args:unknown[])=>{calls.push(args);await wait;if(fails)throw Error('offline');return {error:rpcError,status}}},userId:'flagged-exact-id',suspensionUntil,duration:'indefinite',reason:'scam',note:' reviewed evidence ',hideContent:false,onSuspended:()=>success++};
  const run=new Function(...Object.keys(deps),`${source};return submit`)(...Object.values(deps));
  return {run,finish,calls,errors,success:()=>success,unknown:()=>unknown};
}
test('direct ban requires explicit review and a reason',async()=>{for(const opts of [{confirmed:false},{problem:'Pick a reason.'}]){const h=harness(opts);await h.run();assert.equal(h.calls.length,0)}});
test('double submit targets exact flagged ID once, indefinite and no implicit hiding',async()=>{const h=harness();const first=h.run();await h.run();h.finish();await first;assert.deepEqual(h.calls,[['admin_suspend_user',{p_user_id:'flagged-exact-id',p_until:null,p_reason:'scam',p_note:'reviewed evidence',p_hide_content:false}]]);assert.equal(h.success(),1)});
test('RPC and thrown failures never report a successful ban',async()=>{for(const opts of [{fails:true},{rpcError:{message:'Cannot suspend admin'}}]){const h=harness(opts);const p=h.run();h.finish();await p;assert.equal(h.success(),0);assert.ok(h.errors.at(-1))}});
test('queue offers direct action without confirming violation first, applies parent guards',()=>{const card=readFileSync(new URL('../src/components/admin/SafetyReview.tsx',import.meta.url),'utf8');const page=readFileSync(new URL('../src/pages/AdminDashboard.tsx',import.meta.url),'utf8');assert.match(card,/canSuspend && !f.subject_suspended/);assert.match(card,/Ban account…/);assert.match(card,/name=\{name\}/);assert.match(page,/SafetyReview canSuspend=\{canSuspend\}/);assert.match(page,/userId !== selfId && !adminIds.has\(userId\)/)});

test('resolved transport and server failures require refreshing before another attempt',async()=>{for(const status of [0,502]){const h=harness({status,rpcError:{message:'Failed to fetch'}});const p=h.run();h.finish();await p;assert.equal(h.unknown(),true);assert.equal(h.success(),0);assert.match(String(h.errors.at(-1)),/refresh/);}});
