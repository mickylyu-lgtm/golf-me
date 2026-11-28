import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { SimulatorApi } from "../../lib/simulatorApiContext";
import { confirmSimulatorLabel, confirmSimulatorReceipt, normalizedSimulatorReceipt, type SimulatorCleanup, type SimulatorLabelCleanup } from "../../lib/simulatorSessions";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { simulatorLabelText } from "./SimulatorLabelSelect";

export function SimulatorMembershipRecovery({ api, discoveryAvailable=true }: { api: SimulatorApi; discoveryAvailable?:boolean }) {
 const { t } = useLocale();
 const region = useId();
 const [hasOwnSessions,setHasOwnSessions]=useState(false);
 const [open, setOpen] = useState(false);
 const [code, setCode] = useState("");
 const [offer, setOffer] = useState<{ receipt:string; entry:SimulatorCleanup } | null>(null);
 const [labels,setLabels]=useState<SimulatorLabelCleanup[]>([]);
 const [labelOffer,setLabelOffer]=useState<SimulatorLabelCleanup|null>(null);
 const [labelsReady,setLabelsReady]=useState(false);
 const [labelsError,setLabelsError]=useState(false);
 const [status, setStatus] = useState("");
 const [loading, setLoading] = useState(false);
 const busy = useRef(false);
 const generation=useRef(0);
 useLayoutEffect(()=>{++generation.current;return ()=>{++generation.current}},[api]);
 // During a private launch, accounts without pilot access should not see
 // a Simulator control. Previously committed members retain exact recovery.
 useEffect(()=>{
  if(discoveryAvailable)return;
  let live=true;
  const verify=()=>{void api.listLabelCleanup().then(rows=>{if(live)setHasOwnSessions(rows.length>0)},()=>{})};
  verify();
  window.addEventListener("focus",verify);
  return ()=>{live=false;window.removeEventListener("focus",verify)};
 },[api,discoveryAvailable]);
 const field = "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800";

 async function loadLabels(request:number){
  setLabelsError(false);setLabelsReady(false);
  try { const entries=await api.listLabelCleanup(); if(request===generation.current)setLabels(entries); }
  catch { if(request===generation.current){setLabels([]);setLabelsError(true)} }
  finally { if(request===generation.current)setLabelsReady(true) }
 }

 async function resolveLabel(selected:SimulatorLabelCleanup){
  if(busy.current)return;
  const request=generation.current;
  const current=()=>request===generation.current;
  busy.current=true;setLoading(true);
  try {
   const applied=await confirmSimulatorLabel(api,selected,current);
   if(current())setStatus(t(applied?"simulator.recoverySubmitted":"simulator.recoveryChanged"));
  }catch{if(current())setStatus(t("simulator.retry"))}
  finally{
   if(current()){setLabelOffer(null);await loadLabels(request);if(current())setLoading(false)}
   busy.current=false;
  }
 }

 async function lookup() {
  if (busy.current) return;
  setStatus("");
  const receipt=normalizedSimulatorReceipt(code);
  if (!receipt) { setStatus(t("simulator.recoveryNoMatch")); return; }
  const request=generation.current;
  busy.current=true;
  setLoading(true);
  try {
   const entry=await api.findCleanup(receipt);
   if(request!==generation.current)return;
   if (entry) setOffer({receipt,entry});
   else setStatus(t("simulator.recoveryNoMatch"));
  } catch {
   if(request===generation.current)setStatus(t("simulator.retry"));
  } finally {
   busy.current=false;
   if(request===generation.current)setLoading(false);
  }
 }

 async function resolve(selected:NonNullable<typeof offer>) {
  if (busy.current) return;
  const request=generation.current;
  const current=()=>request===generation.current;
  busy.current=true;setLoading(true);
  try {
   const submitted=await confirmSimulatorReceipt(api,selected.receipt,selected.entry,current);
   if(!current())return;
   setStatus(t(submitted ? "simulator.recoverySubmitted" : "simulator.recoveryChanged"));
   setCode("");
  } catch {
   if(current())setStatus(t("simulator.retry"));
  } finally {
   busy.current=false;
   if(current()){setOffer(null);setLoading(false)}
  }
 }

 if(!open&&!discoveryAvailable&&!hasOwnSessions)return null;
 return <section className="my-4 space-y-3">
  <button type="button" className={field} disabled={loading} aria-expanded={open} aria-controls={region} onClick={()=>{
   if(busy.current)return;
   setCode(""); setStatus(""); setOpen(!open);
   const request=++generation.current;
   setLabels([]);setLabelsError(false);
   if(!open)void loadLabels(request);
  }}>{t("simulator.recoveryTitle")}</button>
  <div id={region} hidden={!open} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
   {status && <p role="status">{status}</p>}
   {!labelsReady && <p role="status">{t("simulator.recoveryLoading")}</p>}
   {labelsReady && !labelsError && labels.length===0 && <p>{t("simulator.recoveryEmpty")}</p>}
   {labelsError && <button type="button" className={field} disabled={loading} onClick={()=>{if(!busy.current)void loadLabels(generation.current)}}>{t("simulator.refresh")}</button>}
   {labelsReady&&labels.map(entry=><button key={entry.label} type="button" className={field+" block"} disabled={loading}
    onClick={()=>{if(!busy.current)setLabelOffer(entry)}}>
    {simulatorLabelText(entry.label,t)} · {t(entry.action==="cancel"?"simulator.cancel":"simulator.leave")}
   </button>)}
   <p>{t("simulator.recoveryEnterCode")}</p>
   <form className="space-y-2" onSubmit={e=>{e.preventDefault();void lookup()}}>
    <label className="block">{t("simulator.recoveryCode")}
     <input className="mt-1 block w-full rounded-xl border border-slate-200 p-2" value={code}
      onChange={e=>setCode(e.target.value)} disabled={loading} maxLength={64}
      autoComplete="off" autoCapitalize="none" spellCheck={false} required />
    </label>
    <button className={field} disabled={loading}>{t(loading ? "simulator.recoveryLoading" : "simulator.recoveryReviewSession")}</button>
   </form>
  </div>
  {labelOffer && <ConfirmDialog
   title={t(labelOffer.action==="cancel"?"simulator.recoveryReviewCancel":"simulator.recoveryReviewLeave")}
   message={simulatorLabelText(labelOffer.label,t)+" · "+t(labelOffer.action==="cancel"?"simulator.confirmCancel":"simulator.labelConfirmLeave")}
   confirmLabel={t(labelOffer.action==="cancel"?"simulator.cancel":"simulator.leave")}
   danger onCancel={()=>setLabelOffer(null)} onConfirm={()=>resolveLabel(labelOffer)}
  />}
  {offer && <ConfirmDialog
   title={t(offer.entry.action === "cancel" ? "simulator.recoveryReviewCancel" : "simulator.recoveryReviewLeave")}
   message={t(offer.entry.action === "cancel" ? "simulator.recoveryConfirmCancel" : "simulator.recoveryConfirmLeave")}
   confirmLabel={t(offer.entry.action === "cancel" ? "simulator.cancel" : "simulator.leave")}
   danger
   onCancel={() => setOffer(null)}
   onConfirm={() => resolve(offer)}
  />}
 </section>;
}
