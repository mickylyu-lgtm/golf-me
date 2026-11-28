import {simulatorCapacities} from '../../data/simulatorVenues';
import {useLocale} from "../../i18n/LocaleContext";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {simulatorCityForLocation,simulatorVenuesForCity} from '../../data/simulatorVenues';
import {clearSimulatorCreateKey,readSimulatorCreateKey,saveSimulatorCreateKey,isDefinitiveSimulatorCreateFailure,isSimulatorRecoveryLabel,pendingSimulatorJoinSlot,SIMULATOR_RECOVERY_LABELS,simulatorStartInstant,withSimulatorLabel,type SimulatorDraft,type SimulatorRecoveryLabel,type SimulatorSession,type createSimulatorSessions} from '../../lib/simulatorSessions';
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { SimulatorRecoveryCode } from "./SimulatorRecoveryCode";
import { simulatorLabelText } from "./SimulatorLabelSelect";
type Api=ReturnType<typeof createSimulatorSessions>;
/** Real persistence view; dependency injection keeps local verification isolated from production. */
export function SimulatorSessions({api,locationLabel,initialHosting=false,actorId}:{api:Api;locationLabel:string;initialHosting?:boolean;actorId?:string}){
 const {t,locale}=useLocale();
 const city=simulatorCityForLocation(locationLabel);const venues=simulatorVenuesForCity(city);
 const [hosting,setHosting]=useState(initialHosting);const [rows,setRows]=useState<SimulatorSession[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');const inFlight=useRef(false);const retry=useRef<{label:SimulatorRecoveryLabel;fingerprint:string;key:string}|null>(null);
 const joinAttempts=useRef<Map<string,SimulatorRecoveryLabel>>(new Map());
 const [cancelTarget,setCancelTarget]=useState<{id:string;city:string}|null>(null);
 const [access,setAccess]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
 const [venue,setVenue]=useState(venues[0]?.id??'');const current=venues.find(v=>v.id===venue)??venues[0];
 const generation=useRef(0);
 useLayoutEffect(()=>{
  ++generation.current;
  retry.current=null;
  joinAttempts.current.clear();
  inFlight.current=false;
  setBusy(false);setError("");setStatus("");setCancelTarget(null);
  return ()=>{++generation.current};
 },[api,city,actorId]);
 async function refresh(){
  if(!city){setRows([]);return}
  const request=generation.current;
  try{const nextRows=await api.list(city);if(request===generation.current){setRows(nextRows);setAccess("ready")}}
  catch(error){if(request===generation.current){setRows([]);setAccess(listFailure(error));throw error}}
 }
 useEffect(()=>{
  let active=true;
  setRows([]);
  setAccess("loading");
  if(city)api.list(city).then(r=>{if(active){setRows(r);setAccess("ready")}})
    .catch((failure:unknown)=>{if(active)setAccess(listFailure(failure))});
  return()=>{active=false};
 },[api,city]);
 const field='mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900';
 async function act(action:(current:()=>boolean)=>Promise<unknown>,message:string,onSuccess?:()=>void){
  if(inFlight.current)return;
  const request=generation.current;
  inFlight.current=true;setBusy(true);setError("");setStatus("");
  try{
   await action(()=>request===generation.current);
   if(request!==generation.current)return;
   onSuccess?.();
   setStatus(message);
   try{await refresh()}catch{/* The mutation succeeded; refresh presents its own retry state. */}
  }catch(e){if(request===generation.current)setError(simulatorError(e,t))}
  finally{if(request===generation.current){inFlight.current=false;setBusy(false)}}
 }
 function tabStorage():Storage|undefined{try{return window.sessionStorage}catch{return undefined}}
 function post(draft:Omit<SimulatorDraft,"requestId"|"recoveryLabel">){
  const storage=tabStorage();
  const preferred=SIMULATOR_RECOVERY_LABELS.find(label=>readSimulatorCreateKey(storage,actorId,label))??retry.current?.label;
  const fingerprint=JSON.stringify(draft);
  void act(current=>withSimulatorLabel(preferred,async label=>{
   if(!current())throw new Error("simulator_unavailable");
   const existing=retry.current;
   const key=readSimulatorCreateKey(storage,actorId,label)??
    (existing?.label===label&&existing.fingerprint===fingerprint?existing.key:crypto.randomUUID());
   retry.current={label,fingerprint,key};
   saveSimulatorCreateKey(storage,actorId,label,key);
   const clear=()=>{
    if(!current())return;
    clearSimulatorCreateKey(storage,actorId,label,key);
    if(retry.current?.key===key)retry.current=null;
   };
   try{const id=await api.create({...draft,recoveryLabel:label,requestId:key});clear();return id}
   catch(e){if(isDefinitiveSimulatorCreateFailure(e))clear();throw e}
  }),t("simulator.posted"),()=>setHosting(false));
 }
 function join(sessionId:string){
  const storage=tabStorage();
  const slot=pendingSimulatorJoinSlot(actorId,sessionId);
  let saved:unknown;
  try{saved=slot?storage?.getItem(slot):null}catch{/* Optional storage. */}
  const preferred=isSimulatorRecoveryLabel(saved)?saved:joinAttempts.current.get(sessionId);
  void act(current=>withSimulatorLabel(preferred,async label=>{
   if(!current())throw new Error("simulator_unavailable");
   joinAttempts.current.set(sessionId,label);
   try{if(slot)storage?.setItem(slot,label)}catch{/* Optional storage. */}
   const clear=()=>{
    if(!current())return;
    if(joinAttempts.current.get(sessionId)===label)joinAttempts.current.delete(sessionId);
    try{if(slot&&storage?.getItem(slot)===label)storage.removeItem(slot)}catch{/* Optional storage. */}
   };
   try{await api.join(sessionId,label);clear()}
   catch(e){
    if(e instanceof Error&&["recovery_label_in_use","session_full","simulator_open_join_limit","label_conflict_stale","invalid_recovery_label"].includes(e.message))clear();
    throw e;
   }
  }),t("simulator.joined"));
 }
 const area=locationLabel.trim();
 if(!area)return <p>{t("simulator.playingAreaRequired")}</p>;
 if(!city||!current)return <p>{t("simulator.noVenues",{area})}</p>;
 if(access==="loading")return <p role="status">{t("simulator.recoveryLoading")}</p>;
 if(access==="unavailable")return <p role="status">{t("simulator.pilotUnavailable")}</p>;
 if(access==="error")return <div className="space-y-3">
  {status && <p role="status">{status}</p>}
  <p role="alert">{t("simulator.loadError")}</p>
  <button type="button" className={field} onClick={()=>{
   setAccess("loading");
   void refresh().catch(()=>{/* refresh renders the neutral/error state */});
  }}>{t("simulator.refresh")}</button>
 </div>;

 return <section className="space-y-5"><h2 className="text-2xl font-bold">{hosting?t("simulator.host"):t("simulator.title")}</h2><p className="text-sm text-slate-500">{t("simulator.disclaimer")}</p>{error&&<p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</p>}{status&&<p role="status" className="rounded-2xl bg-green-50 p-4">{status}</p>}
 {hosting?<form className="space-y-4" onSubmit={e=>{e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);let startsAt:string;try{startsAt=simulatorStartInstant(String(f.get('date')),String(f.get('time')),current.timezone)}catch{setError(t("simulator.invalidTime"));return}post({venueId:current.id,startsAt,durationMinutes:Number(f.get('duration')) as SimulatorDraft["durationMinutes"],capacity:Number(f.get('capacity')) as SimulatorDraft["capacity"]})}}>
 <label className="block">{t("simulator.venue")}<select className={field} value={current.id} onChange={e=>setVenue(e.target.value)} disabled={busy}>{venues.map(v=><option key={v.id} value={v.id}>{v.name} · {v.area}</option>)}</select></label><p className="text-xs">{current.address} · {current.timezone}</p>
 <label className="block">{t("simulator.date")}<input className={field} name="date" type="date" required disabled={busy}/></label><label className="block">{t("simulator.time")}<input className={field} name="time" type="time" required disabled={busy}/></label>
 <label className="block">{t("simulator.duration")}<select className={field} name="duration" disabled={busy}>{[60,90,120].map(n=><option key={n} value={n}>{t("simulator.minutes",{count:n})}</option>)}</select></label><label className="block">{t("simulator.size")}<select className={field} name="capacity" key={current.id} disabled={busy}>{simulatorCapacities(current).map(n=><option key={n} value={n}>{t("simulator.golfers",{count:n})}</option>)}</select></label><label className="flex gap-3 text-sm"><input type="checkbox" required disabled={busy}/>{t("simulator.ack")}</label><button disabled={busy} className={field}>{busy?t("simulator.saving"):t("simulator.post")}</button></form>:<><button className={field} disabled={busy} onClick={()=>setHosting(true)}>{t("simulator.host")}</button><button className={field} disabled={busy} onClick={()=>void act(refresh,t("simulator.refreshed"))}>{t("simulator.refresh")}</button>{rows.length===0&&<p>{t("simulator.empty",{area:locationLabel})}</p>}{rows.map(row=>{const v=venues.find(v=>v.id===row.venue_id);return <article key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5" data-session-id={row.id}><span className="text-xs font-semibold">{t("simulator.category")}</span><h3 className="mt-2 font-bold">{v?`${v.name} · ${v.area}`:t("simulator.session")}</h3><p>{new Intl.DateTimeFormat(locale,{timeZone:v?.timezone??current.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(row.starts_at))} · {t("simulator.minutes",{count:row.duration_minutes})}</p><p>{t("simulator.occupancy",{occupied:row.occupied,capacity:row.capacity})}</p>{row.is_host?<button className={field} disabled={busy} onClick={()=>{if(city)setCancelTarget({id:row.id,city})}}>{t("simulator.cancel")}</button>:row.joined?<button className={field} disabled={busy} onClick={()=>void act(()=>api.leave(row.id),t("simulator.left"))}>{t("simulator.leave")}</button>:<button className={field} disabled={busy||row.occupied>=row.capacity} onClick={()=>join(row.id)}>{row.occupied>=row.capacity?t("simulator.full"):t("simulator.join")}</button>}{(row.joined||row.is_host)&&<details className="mt-3 text-sm text-slate-600">
  <summary className="cursor-pointer font-medium">{t("simulator.manageThisSession")}</summary>
  {isSimulatorRecoveryLabel(row.own_recovery_label)&&<p className="mt-2">{t("simulator.labelReminder",{label:simulatorLabelText(row.own_recovery_label,t)})}</p>}
  <SimulatorRecoveryCode api={api} sessionId={row.id}/>
 </details>}</article>})}</>}
 {cancelTarget && cancelTarget.city===city && <ConfirmDialog
  title={t("simulator.recoveryReviewCancel")}
  message={t("simulator.confirmCancel")}
  confirmLabel={t("simulator.cancel")}
  danger
  onCancel={()=>setCancelTarget(null)}
  onConfirm={async()=>{
   const request=generation.current;
   if(inFlight.current)return;
   await act(()=>api.cancel(cancelTarget.id),t("simulator.cancelled"));
   if(request===generation.current)setCancelTarget(null);
  }}
 />}
 </section>;
}
function simulatorError(error:unknown,t:ReturnType<typeof useLocale>["t"]):string {
 const code=error instanceof Error?error.message:"";

 if(code==="request_payload_changed")return t("simulator.hostRetryChanged");
 if(code==="request_stale")return t("simulator.hostRetryStale");
 if(code==="label_conflict_stale")return t("simulator.recoveryChanged");
 if(code.includes("session_full"))return t("simulator.full");
 if(code.includes("simulator_open_join_limit"))return t("simulator.joinLimit");
 if(code.includes("simulator_open_host_limit"))return t("simulator.hostLimit");
 if(code.includes("simulator_rolling_create_limit"))return t("simulator.rateLimit");
 if(code.includes("unavailable"))return t("simulator.unavailable");
 if(code.includes("invalid_start_time"))return t("simulator.invalidTime");
 return t("simulator.retry");
}

function listFailure(error: unknown): "unavailable" | "error" {
 return error instanceof Error && error.message === "simulator_unavailable" ? "unavailable" : "error";
}
