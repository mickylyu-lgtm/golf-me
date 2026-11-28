import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulatorCityForLocation,simulatorVenuesForCity,simulatorCapacities} from '../src/data/simulatorVenues.ts';
import {createSimulatorSessions,simulatorStartInstant} from '../src/lib/simulatorSessions.ts';
test('HK branches distinct; no cross-city or fallback',()=>{const hk=simulatorVenuesForCity('hk');assert.equal(hk.length,5);assert.equal(new Set(hk.map(v=>v.id)).size,5);assert.equal(simulatorVenuesForCity('nyc').length,2);assert.equal(simulatorCityForLocation('Hong Kong'),'hk');assert.equal(simulatorCityForLocation('London'),undefined);assert.deepEqual(simulatorVenuesForCity(undefined),[])});
test('venue time conversion and DST rejection',()=>{assert.equal(simulatorStartInstant('2026-12-01','18:00','Asia/Hong_Kong'),'2026-12-01T10:00:00.000Z');assert.equal(simulatorStartInstant('2026-12-01','18:00','America/New_York'),'2026-12-01T23:00:00.000Z');assert.throws(()=>simulatorStartInstant('2027-03-14','02:30','America/New_York'),/nonexistent/);assert.throws(()=>simulatorStartInstant('2027-11-07','01:30','America/New_York'),/ambiguous/);});
test('RPC transport preserves city, retry key and propagates errors',async()=>{const calls:unknown[]=[];const api=createSimulatorSessions(async(name,args)=>{calls.push([name,args]);return {data:[],error:null}});await api.list('hk');assert.deepEqual(calls[0],['list_simulator_sessions',{city:'hk'}]);const draft={requestId:'retry',venueId:'golfzon-tste',startsAt:'2026-12-01T10:00:00Z',durationMinutes:60 as const,capacity:2 as const,recoveryLabel:'blue-1' as const};await api.create(draft);await api.create(draft);assert.deepEqual(calls[1],calls[2]);const failed=createSimulatorSessions(async()=>({data:null,error:{message:'session_full'}}));await assert.rejects(()=>failed.join('s','green-2'),/session_full/);});

import {isFindTab,resolveFindTab,findTabPath} from '../src/lib/findTab.ts';
test('Simulators selection preserves Courses and explicit deep links',()=>{assert.equal(isFindTab('simulators'),true);assert.equal(isFindTab('courses'),true);assert.equal(resolveFindTab('simulators','courses'),'simulators');assert.equal(resolveFindTab(null,'courses'),'courses');assert.equal(findTabPath('simulators'),'/find?tab=simulators')});

import {en} from '../src/i18n/locales/en.ts';
import {zhCN} from '../src/i18n/locales/zh-CN.ts';
import {zhTW} from '../src/i18n/locales/zh-TW.ts';
import {es} from '../src/i18n/locales/es.ts';
import {ko} from '../src/i18n/locales/ko.ts';
import {ja} from '../src/i18n/locales/ja.ts';
test('six locales preserve Simulator placeholders and nonempty messages',()=>{const keys=Object.keys(en).filter(k=>k.startsWith('simulator.')) as (keyof typeof en)[];assert.ok(keys.length>30);for(const dictionary of [zhCN,zhTW,es,ko,ja])for(const key of keys){assert.ok(dictionary[key]?.trim());assert.deepEqual([...dictionary[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key)}});

test('locationless Simulator copy asks users to set an area without interpolating a place',()=>{
 for(const dictionary of [en,zhCN,zhTW,es,ko,ja]){
  assert.ok(dictionary['simulator.playingAreaRequired'].trim());
  assert.doesNotMatch(dictionary['simulator.playingAreaRequired'],/\{\w+\}/);
  assert.match(dictionary['simulator.noVenues'],/\{area\}/);
 }
});
test('Flatiron six total capacity does not expand unverified venues',()=>{for(const venue of [...simulatorVenuesForCity('nyc'),...simulatorVenuesForCity('hk')])assert.deepEqual(simulatorCapacities(venue),venue.id==='flatiron'?[2,3,4,5,6]:[2,3,4]);});
test('cancel copy distinguishes GolfMe from venue reservations',()=>{assert.match(en['simulator.size'],/including you/);assert.match(en['simulator.confirmCancel'],/does not cancel a separately booked/);assert.match(en['simulator.cancelled'],/bay booking is unchanged/);});

import {confirmSimulatorReceipt,normalizedSimulatorReceipt,simulatorClientEnabled} from '../src/lib/simulatorSessions.ts';
const checkpointToken = '10000000-0000-4000-8000-000000000001';
test('simulator client transport is off unless explicitly enabled for a signed-in non-demo account',()=>{
 assert.equal(simulatorClientEnabled(undefined,'signed-in',false),false);
 assert.equal(simulatorClientEnabled('TRUE','signed-in',false),false);
 assert.equal(simulatorClientEnabled('true',undefined,false),false);
 assert.equal(simulatorClientEnabled('true','signed-in',true),false);
 assert.equal(simulatorClientEnabled('true','signed-in',false),true);
});
test('recovery looks up an exact proof and rejects any metadata',async()=>{
 const calls:unknown[]=[];
 const code='11223344-1111-4111-8111-111122223333';
 const api=createSimulatorSessions(async(name,args)=>{
  calls.push([name,args]);
  return {data:name==='issue_simulator_recovery_receipt'?code:name==='find_simulator_cleanup'?{cleanup_token:checkpointToken,action:'leave'}:true,error:null};
 });
 assert.equal(await api.issueReceipt(code),code);
 assert.equal(normalizedSimulatorReceipt('  '+code+' '),code);
 assert.equal(normalizedSimulatorReceipt('not a code'),null);
 assert.equal(await api.findCleanup('not a code'),null);
 const entry=await api.findCleanup(code);
 assert.deepEqual(entry,{cleanup_token:checkpointToken,action:'leave'});
 assert.equal(await api.resolveReceiptCleanup(code,entry!),true);
 assert.deepEqual(calls,[['issue_simulator_recovery_receipt',{session_id:code}],['find_simulator_cleanup',{receipt:code}],['resolve_simulator_cleanup',{token:checkpointToken,receipt:code,expected_action:'leave'}]]);
 const unexpected=createSimulatorSessions(async()=>({data:{...entry,venue:'must not render'},error:null}));
 await assert.rejects(()=>unexpected.findCleanup(code),/simulator_cleanup_invalid/);
});
test('confirmation rechecks exact receipt, token and action without substituting another target',async()=>{
 const offered={cleanup_token:checkpointToken,action:'leave'} as const;
 const other={...offered,cleanup_token:'10000000-0000-4000-8000-000000000002'};
 const code='11223344-1111-4111-8111-111122223333';
 const calls:unknown[]=[];
 for(const state of [null,other,{...offered,action:'cancel'} as const]){
  assert.equal(await confirmSimulatorReceipt({findCleanup:async()=>state,resolveReceiptCleanup:async(...args)=>{calls.push(args);return true}},code,offered),false);
 }
 assert.deepEqual(calls,[]);
 assert.equal(await confirmSimulatorReceipt({findCleanup:async()=>offered,resolveReceiptCleanup:async(...args)=>{calls.push(args);return true}},code,offered),true);
 assert.deepEqual(calls,[[code,offered]]);
 assert.equal(await confirmSimulatorReceipt({findCleanup:async()=>offered,resolveReceiptCleanup:async()=>false},code,offered),false);
});

import {simulatorRpcAllowed} from '../src/lib/simulatorSessions.ts';
test('recovery and discovery transports cannot cross lifecycle RPC scopes',()=>{
 assert.equal(simulatorRpcAllowed('recovery','issue_simulator_recovery_receipt'),false);
 assert.equal(simulatorRpcAllowed('recovery','find_simulator_cleanup'),true);
 assert.equal(simulatorRpcAllowed('recovery','resolve_simulator_cleanup'),true);
 for(const rpc of ['list_simulator_sessions','create_simulator_session','join_simulator_session','leave_simulator_session','cancel_simulator_session','issue_simulator_recovery_receipt']){
  assert.equal(simulatorRpcAllowed('discovery',rpc),true);
  assert.equal(simulatorRpcAllowed('recovery',rpc),false);
 }
 assert.equal(simulatorRpcAllowed('discovery','find_simulator_cleanup'),false);
 assert.equal(simulatorRpcAllowed('discovery','resolve_simulator_cleanup'),false);
 assert.equal(simulatorRpcAllowed('recovery','unknown_rpc'),false);
});

test('picker probes eligibility without fetching any city or session data',async()=>{
 const calls:unknown[]=[];
 const yes=createSimulatorSessions(async(name,args)=>{calls.push([name,args]);return {data:[],error:null}});
 assert.equal(await yes.canDiscover(),true);
 assert.deepEqual(calls,[['list_simulator_sessions',{city:null}]]);
 for(const data of [null,{},[{unexpected:'session'}]]){
  assert.equal(await createSimulatorSessions(async()=>({data,error:null})).canDiscover(),false);
 }
 await assert.rejects(()=>createSimulatorSessions(async()=>({data:null,error:{message:'simulator_unavailable'}})).canDiscover(),/simulator_unavailable/);
});

import {confirmSimulatorLabel, decodeSimulatorLabelCleanup, isSimulatorRecoveryLabel, SIMULATOR_RECOVERY_LABELS} from '../src/lib/simulatorSessions.ts';
test('fixed recovery labels are unique and stable across locale',()=>{
 assert.equal(new Set(SIMULATOR_RECOVERY_LABELS).size,24);
 assert.equal(isSimulatorRecoveryLabel('blue-1'),true);
 for(const value of ['Blue 1','blue-0','blue-7',' blue-1',null]) assert.equal(isSimulatorRecoveryLabel(value),false);
});
test('label recovery accepts only its minimal projection and rejects ambiguity',()=>{
 const x={label:'blue-1',action:'leave',token:checkpointToken};
 const other='10000000-0000-4000-8000-000000000002';
 assert.deepEqual(decodeSimulatorLabelCleanup([x]),[x]);
 for(const value of [[x,{...x,token:other}],[x,{...x,label:'blue-2'}],[{...x,venue:'hidden'}],[{...x,action:'join'}],null])
  assert.throws(()=>decodeSimulatorLabelCleanup(value),/simulator_cleanup_invalid/);
});
test('label recovery never applies a changed choice or reports success after account changes',async()=>{
 const x={label:'blue-1',action:'leave',token:checkpointToken} as const;
 let actual=true, writes=0;
 const mutate=async()=>{writes++;return true};
 for(const entry of [{...x,action:'cancel'} as const,{...x,label:'green-1'} as const]){
  assert.equal(await confirmSimulatorLabel({listLabelCleanup:async()=>[entry],resolveLabelCleanup:mutate},x,()=>actual),false);
 }
 assert.equal(await confirmSimulatorLabel({listLabelCleanup:async()=>{actual=false;return [x]},resolveLabelCleanup:mutate},x,()=>actual),false);
 assert.equal(writes,0);
 actual=true;
 assert.equal(await confirmSimulatorLabel({listLabelCleanup:async()=>[x],resolveLabelCleanup:async()=>{actual=false;return true}},x,()=>actual),false);
 actual=true;
 assert.equal(await confirmSimulatorLabel({listLabelCleanup:async()=>[x],resolveLabelCleanup:mutate},x,()=>actual),true);
 assert.equal(writes,1);
});
test('transport passes exact recovery label on both host and join, with cleanup separate',async()=>{
 const calls:unknown[]=[];
 const api=createSimulatorSessions(async(name,args)=>{calls.push([name,args]);return {data:true,error:null}});
 await api.create({requestId:'r',venueId:'flatiron',startsAt:'future',durationMinutes:60,capacity:4,recoveryLabel:'purple-3'});
 await api.join('id','gold-5');
 await api.resolveLabelCleanup({label:'gold-5',token:checkpointToken,action:'leave'});
 assert.deepEqual(calls,[
  ['create_simulator_session',{request_id:'r',venue_id:'flatiron',starts_at:'future',duration_minutes:60,capacity:4,recovery_label:'purple-3'}],
  ['join_simulator_session',{session_id:'id',recovery_label:'gold-5'}],
  ['resolve_simulator_label_cleanup',{token:checkpointToken,label:'gold-5',expected_action:'leave'}],
 ]);
 for(const name of ['list_simulator_label_cleanup','resolve_simulator_label_cleanup']){
  assert.equal(simulatorRpcAllowed('recovery',name),true);
  assert.equal(simulatorRpcAllowed('discovery',name),false);
 }
});

import {isDefinitiveSimulatorCreateFailure} from '../src/lib/simulatorSessions.ts';
test('definitive server rejection ends a retry but unknown transport outcomes retain it',()=>{
 for(const code of ['request_stale','request_payload_changed','recovery_label_in_use','invalid_capacity','simulator_rolling_create_limit'])
  assert.equal(isDefinitiveSimulatorCreateFailure(Error(code)),true);
 for(const failure of [new TypeError('Failed to fetch'),Error('Gateway timeout'),Error(''),null])
  assert.equal(isDefinitiveSimulatorCreateFailure(failure),false);
});

import {readSimulatorCreateKey,saveSimulatorCreateKey,clearSimulatorCreateKey} from '../src/lib/simulatorSessions.ts';
test('pending create keys survive views, isolate accounts and labels, and cannot clear a newer attempt',()=>{
 const a='10000000-0000-4000-8000-000000000003', b='10000000-0000-4000-8000-000000000004';
 const first='10000000-0000-4000-8000-000000000005', second='10000000-0000-4000-8000-000000000006';
 const map=new Map<string,string>();
 const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}};
 saveSimulatorCreateKey(storage,a,'blue-1',first);
 assert.equal(readSimulatorCreateKey(storage,b,'blue-1'),null);
 assert.equal(readSimulatorCreateKey(storage,a,'gold-1'),null);
 assert.equal(readSimulatorCreateKey(storage,a,'blue-1'),first);
 saveSimulatorCreateKey(storage,a,'blue-1',second);
 clearSimulatorCreateKey(storage,a,'blue-1',first);
 assert.equal(readSimulatorCreateKey(storage,a,'blue-1'),second);
 clearSimulatorCreateKey(storage,a,'blue-1',second);
 assert.equal(readSimulatorCreateKey(storage,a,'blue-1'),null);
 assert.equal(isDefinitiveSimulatorCreateFailure(Error('simulator_unavailable')),false);
});

import {withSimulatorLabel,pendingSimulatorJoinSlot} from '../src/lib/simulatorSessions.ts';
test('automatic labels only try another option after an exact collision',async()=>{
 const seen:string[]=[];
 const result=await withSimulatorLabel('gold-2',async label=>{
  seen.push(label);
  if(seen.length===1)throw Error('recovery_label_in_use');
  return label;
 });
 assert.deepEqual(seen,['gold-2','blue-1']);
 assert.equal(result,'blue-1');
 const unknown:string[]=[];
 await assert.rejects(withSimulatorLabel('purple-2',async label=>{unknown.push(label);throw Error('Failed to fetch')}),/Failed to fetch/);
 assert.deepEqual(unknown,['purple-2']);
 assert.equal(pendingSimulatorJoinSlot('malformed','also-bad'),null);
});
