import { useState } from "react";
import { useLocale } from "../../i18n/LocaleContext";
import type { SimulatorApi } from "../../lib/simulatorApiContext";

/** Offer a session-specific code while this card still belongs to the current account. */
export function SimulatorRecoveryCode({api,sessionId}:{api: SimulatorApi;sessionId:string}) {
 const {t}=useLocale();
 const [state,setState]=useState<"idle"|"loading"|"error">("idle");
 const [receipt,setReceipt]=useState<string|null>(null);
 async function reveal() {
  setReceipt(null);
  setState("loading");
  try {
   const value=await api.issueReceipt(sessionId);
   setReceipt(value);
   setState(value ? "idle" : "error");
  } catch {
   setState("error");
  }
 }
 return <div className="mt-2 space-y-2 text-sm text-slate-600">
  <button type="button" className="font-semibold underline" aria-expanded={Boolean(receipt)} disabled={state==="loading"} onClick={()=>{
   if(receipt) setReceipt(null); else void reveal();
  }}>{t("simulator.recoveryCode")}</button>
  {state==="error" && <p role="status">{t("simulator.retry")}</p>}
  {receipt && <>
   <p>{t("simulator.recoverySaveCode")}</p>
   <input aria-label={t("simulator.recoveryCode")} className="w-full rounded-xl border border-slate-200 p-2 text-slate-900"
    value={receipt} readOnly onFocus={e=>e.currentTarget.select()} />
  </>}
 </div>;
}
