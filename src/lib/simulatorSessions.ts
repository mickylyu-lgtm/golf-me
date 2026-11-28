import type { SimulatorCity } from '../data/simulatorVenues';
export type SimulatorSession = { id:string; venue_id:string; starts_at:string; duration_minutes:number; capacity:number; occupied:number; joined:boolean; is_host:boolean; own_recovery_label?:SimulatorRecoveryLabel|null };
export type SimulatorDraft = { requestId:string; venueId:string; startsAt:string; durationMinutes:60|90|120; capacity:2|3|4|5|6; recoveryLabel:SimulatorRecoveryLabel };
export type SimulatorRpc = (name:string, args:Record<string, unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
export type SimulatorCleanup = { cleanup_token: string; action: "leave" | "cancel" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const SIMULATOR_LABEL_COLORS = ["blue","green","gold","purple"] as const;
const labelNumbers = [1,2,3,4,5,6] as const;
export type SimulatorRecoveryLabel = `${typeof SIMULATOR_LABEL_COLORS[number]}-${typeof labelNumbers[number]}`;
export const SIMULATOR_RECOVERY_LABELS = SIMULATOR_LABEL_COLORS.flatMap(color =>
 labelNumbers.map(number => `${color}-${number}` as SimulatorRecoveryLabel)
);
export function isSimulatorRecoveryLabel(value:unknown):value is SimulatorRecoveryLabel {
 return typeof value==="string" && SIMULATOR_RECOVERY_LABELS.some(label=>label===value);
}
export type SimulatorLabelCleanup = { label:SimulatorRecoveryLabel; action:"leave"|"cancel"; token:string };

export function decodeSimulatorLabelCleanup(data:unknown):SimulatorLabelCleanup[] {
 if (!Array.isArray(data) || data.length > SIMULATOR_RECOVERY_LABELS.length) throw new Error("simulator_cleanup_invalid");
 const labels=new Set<string>(), tokens=new Set<string>();
 return data.map(row=>{
  if (!row || typeof row!=="object" || Object.keys(row).length!==3 ||
      !isSimulatorRecoveryLabel(row.label) || (row.action!=="leave" && row.action!=="cancel") ||
      typeof row.token!=="string" || !uuid.test(row.token) ||
      labels.has(row.label) || tokens.has(row.token.toLowerCase())) throw new Error("simulator_cleanup_invalid");
  labels.add(row.label); tokens.add(row.token.toLowerCase());
  return {label:row.label,action:row.action,token:row.token};
 });
}

export async function confirmSimulatorLabel(
 api:{listLabelCleanup:()=>Promise<SimulatorLabelCleanup[]>; resolveLabelCleanup:(entry:SimulatorLabelCleanup)=>Promise<boolean>},
 offered:SimulatorLabelCleanup, current:()=>boolean,
):Promise<boolean> {
 if (!current()) return false;
 const latest=await api.listLabelCleanup();
 if (!current() || !latest.some(row=>row.label===offered.label && row.action===offered.action && row.token===offered.token)) return false;
 const applied=await api.resolveLabelCleanup(offered);
 return current() && applied;
}

const definitiveCreateFailures = new Set([
 "request_stale","request_payload_changed","request_id_required","invalid_start_time",
 "invalid_venue","invalid_capacity","invalid_recovery_label","recovery_label_in_use",
 "simulator_open_host_limit","simulator_rolling_create_limit",
]);
export function isDefinitiveSimulatorCreateFailure(error:unknown):boolean {
 return error instanceof Error && definitiveCreateFailures.has(error.message);
}

type RetryStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
function simulatorRequestSlot(userId:string|undefined,label:SimulatorRecoveryLabel):string|null {
 return userId&&uuid.test(userId)?"golfme:simulator-create:v1:"+userId+":"+label:null;
}
// Only the UUID request ID is stored, never venue, date, or form values.
// Reusing a pending key with changed inputs is rejected by the server.
export function readSimulatorCreateKey(storage:RetryStorage|undefined,userId:string|undefined,label:SimulatorRecoveryLabel):string|null {
 const slot=simulatorRequestSlot(userId,label);
 if(!slot||!storage)return null;
 try{const value=storage.getItem(slot);return value&&uuid.test(value)?value:null}catch{return null}
}
export function saveSimulatorCreateKey(storage:RetryStorage|undefined,userId:string|undefined,label:SimulatorRecoveryLabel,key:string):void {
 const slot=simulatorRequestSlot(userId,label);
 if(!slot||!storage||!uuid.test(key))return;
 try{storage.setItem(slot,key)}catch{/* Actor-wide label uniqueness is the fallback. */}
}
export function clearSimulatorCreateKey(storage:RetryStorage|undefined,userId:string|undefined,label:SimulatorRecoveryLabel,key:string):void {
 const slot=simulatorRequestSlot(userId,label);
 if(!slot||!storage)return;
 try{if(storage.getItem(slot)===key)storage.removeItem(slot)}catch{/* A stale key is safe to retry. */}
}
// Only a definitive occupied-label response permits another attempt. An
// uncertain response may already have created or joined the session.
export async function withSimulatorLabel<T>(preferred:SimulatorRecoveryLabel|undefined,attempt:(label:SimulatorRecoveryLabel)=>Promise<T>):Promise<T> {
 const choices=preferred?[preferred,...SIMULATOR_RECOVERY_LABELS.filter(label=>label!==preferred)]:SIMULATOR_RECOVERY_LABELS;
 for(const label of choices){
  try{return await attempt(label)}
  catch(error){if(!(error instanceof Error)||error.message!=="recovery_label_in_use")throw error}
 }
 throw new Error("simulator_label_pool_exhausted");
}
export function pendingSimulatorJoinSlot(actorId:string|undefined,sessionId:string):string|null {
 return actorId&&uuid.test(actorId)&&uuid.test(sessionId)?"golfme:simulator-join:v1:"+actorId+":"+sessionId:null;
}
export function simulatorClientEnabled(flag: unknown, userId: string | undefined, isDemo: boolean): boolean {
 return flag === "true" && Boolean(userId) && !isDemo;
}

export type SimulatorRpcScope = "discovery" | "recovery";
export function simulatorRpcAllowed(scope: SimulatorRpcScope, name: string): boolean {
 if (scope === "recovery") return ["find_simulator_cleanup","resolve_simulator_cleanup","list_simulator_label_cleanup","resolve_simulator_label_cleanup"].includes(name);
 return ["list_simulator_sessions","create_simulator_session","join_simulator_session","leave_simulator_session","cancel_simulator_session","issue_simulator_recovery_receipt"].includes(name);
}

function decodeCleanup(data: unknown): SimulatorCleanup[] {
 if (!Array.isArray(data) || data.length > 20) throw new Error("simulator_cleanup_invalid");
 return data.map(row => {
  if (!row || typeof row !== "object" || Object.keys(row).length !== 2 ||
      typeof row.cleanup_token !== "string" || !uuid.test(row.cleanup_token) ||
      (row.action !== "leave" && row.action !== "cancel")) {
   throw new Error("simulator_cleanup_invalid");
  }
  return { cleanup_token: row.cleanup_token, action: row.action };
 });
}

export function normalizedSimulatorReceipt(input:string):string|null {
 const value=input.trim().toLowerCase();
 return uuid.test(value) ? value : null;
}

export async function confirmSimulatorReceipt(
 api: { findCleanup: (receipt:string) => Promise<SimulatorCleanup|null>; resolveReceiptCleanup: (receipt:string,offered:SimulatorCleanup) => Promise<boolean> },
 receipt:string, offered:SimulatorCleanup,current:()=>boolean=()=>true,
):Promise<boolean> {
 if(!current())return false;
 const latest=await api.findCleanup(receipt);
 if(!current() || !latest || latest.cleanup_token!==offered.cleanup_token || latest.action!==offered.action) return false;
 const applied=await api.resolveReceiptCleanup(receipt,offered);
 return current() && applied;
}

/** The client transport is injected for fixtures or created by a default-off, signed-in hook. */
export function createSimulatorSessions(rpc:SimulatorRpc) {
 async function call<T>(name:string,args:Record<string,unknown>):Promise<T>{const r=await rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data as T;}
 return {
  // NULL city deliberately returns zero rows, after the existing server-side
  // eligibility check. A rejected or unexpected response must not show the picker.
  canDiscover:async()=>{
   const rows=await call<unknown>('list_simulator_sessions',{city:null});
   return Array.isArray(rows) && rows.length===0;
  },
  list:(city:SimulatorCity)=>call<SimulatorSession[]>('list_simulator_sessions',{city}),
  create:(d:SimulatorDraft)=>call<string>('create_simulator_session',{request_id:d.requestId,venue_id:d.venueId,starts_at:d.startsAt,duration_minutes:d.durationMinutes,capacity:d.capacity,recovery_label:d.recoveryLabel}),
  join:(id:string,recoveryLabel:SimulatorRecoveryLabel)=>call<void>('join_simulator_session',{session_id:id,recovery_label:recoveryLabel}),
  leave:(id:string)=>call<void>('leave_simulator_session',{session_id:id}),
  cancel:(id:string)=>call<void>('cancel_simulator_session',{session_id:id}),
  listLabelCleanup:async()=>decodeSimulatorLabelCleanup(await call<unknown>('list_simulator_label_cleanup',{})),
  resolveLabelCleanup:async(entry:SimulatorLabelCleanup)=>
   await call<unknown>('resolve_simulator_label_cleanup',{token:entry.token,label:entry.label,expected_action:entry.action})===true,
  issueReceipt:async(id:string)=>{
   const value=await call<unknown>('issue_simulator_recovery_receipt',{session_id:id});
   if(value===null) return null;
   if(typeof value!=='string' || !uuid.test(value)) throw new Error("simulator_cleanup_invalid");
   return value;
  },
  findCleanup:async(receipt:string)=>{
   if(!uuid.test(receipt)) return null;
   const value=await call<unknown>('find_simulator_cleanup',{receipt});
   return value===null ? null : decodeCleanup([value])[0];
  },
  resolveReceiptCleanup:async(receipt:string,offered:SimulatorCleanup)=>
   await call<unknown>('resolve_simulator_cleanup',{token:offered.cleanup_token,receipt,expected_action:offered.action})===true,
 };
}
/** Resolve venue wall time, not browser timezone. Reject DST gaps and overlaps instead of guessing. */
export function simulatorStartInstant(date:string,time:string,timezone:string):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new Error('invalid_local_time');
 const base=Date.parse(`${date}T${time}:00Z`);if(!Number.isFinite(base))throw new Error('invalid_local_time');
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const matches:string[]=[];
 for(let offset=-14*60;offset<=14*60;offset+=15){
  const instant=new Date(base-offset*60000);const p=Object.fromEntries(format.formatToParts(instant).map(x=>[x.type,x.value]));
  if(`${p.year}-${p.month}-${p.day}`===date&&`${p.hour}:${p.minute}`===time)matches.push(instant.toISOString());
 }
 if(matches.length!==1)throw new Error(matches.length?'ambiguous_local_time':'nonexistent_local_time');return matches[0];
}