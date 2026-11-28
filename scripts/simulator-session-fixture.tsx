import { createRoot } from "react-dom/client";
import { SimulatorMembershipRecovery } from "../src/components/find/SimulatorMembershipRecovery";
import { SimulatorSessions } from "../src/components/find/SimulatorSessions";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { createSimulatorSessions } from "../src/lib/simulatorSessions";

const query = new URLSearchParams(location.search);
const id = "11223344-1111-4111-8111-111122223333";
const receipt = "11223344-1111-4111-8111-111122223334";
const secondReceipt = "11223344-1111-4111-8111-111122223335";
const token = "11223344-1111-4111-8111-111122223336";
const secondToken = "11223344-1111-4111-8111-111122223337";
const hidden = new Map([[receipt, {cleanup_token: token, action: "leave"}], [secondReceipt, {cleanup_token: secondToken, action: "leave"}]]);
const labelRows = [{label:"blue-1",token,action:"leave"},{label:"gold-2",token:secondToken,action:"cancel"}];
const records:import("../src/lib/simulatorSessions").SimulatorSession[] = [{ id, venue_id: "flatiron", starts_at: "2026-12-01T23:30:00Z", duration_minutes: 60, capacity: 2, occupied: 1, joined: true, is_host: true }];
const flow = query.has("flow");
const hosted = "11223344-1111-4111-8111-111122223338";
let firstRequest:unknown;
let createAttempts=0;
if (flow) Object.assign(records[0],{is_host:false,joined:false});
const root = document.getElementById("root")!;
const api = createSimulatorSessions(async (name, args) => {
  if(flow && name==="create_simulator_session"){
    if(args.recovery_label==="blue-1")return {data:null,error:{message:"recovery_label_in_use"}};
    if(args.recovery_label!=="blue-2") throw Error("Incorrect automatic host label");
    createAttempts++;
    if(createAttempts===1){firstRequest=args.request_id;return {data:null,error:{message:"synthetic lost reply"}}}
    if(createAttempts===2){
      if(firstRequest!==args.request_id)throw Error("Transport retry changed the request key");
      return {data:null,error:{message:"request_stale"}};
    }
    if(firstRequest===args.request_id)throw Error("Retried the definitively stale request key");
    root.dataset.hostedLabel=String(args.recovery_label);
    records.push({id:hosted,venue_id:"flatiron",starts_at:String(args.starts_at),duration_minutes:60,capacity:2,occupied:1,joined:true,is_host:true,own_recovery_label:"blue-2"});
    return {data:hosted,error:null};
  }
  if(flow && name==="join_simulator_session" && args.session_id===id){
    if(args.recovery_label==="blue-1")return {data:null,error:{message:"recovery_label_in_use"}};
    if(args.recovery_label!=="blue-2")throw Error("Incorrect automatic guest label");
    Object.assign(records[0],{joined:true,occupied:2,own_recovery_label:"blue-2"});
    return {data:null,error:null};
  }
  if(flow && name==="leave_simulator_session" && args.session_id===id){
    Object.assign(records[0],{joined:false,occupied:1,own_recovery_label:null});
    return {data:null,error:null};
  }
  if (name === "list_simulator_label_cleanup") return {data:[...labelRows],error:null};
  if (name === "resolve_simulator_label_cleanup") {
    const index=labelRows.findIndex(row=>row.label===args.label&&row.token===args.token&&row.action===args.expected_action);
    if (index<0) return {data:false,error:null};
    root.dataset.recoveredLabel = labelRows[index].label;
    labelRows.splice(index,1);
    return {data:true,error:null};
  }
  if (name === "issue_simulator_recovery_receipt" && args.session_id === id && !query.has("recover")) return {data: receipt, error: null};
  if (name === "find_simulator_cleanup" && typeof args.receipt === "string") return {data: hidden.get(args.receipt) ?? null, error: null};
  if (name === "resolve_simulator_cleanup" && typeof args.receipt === "string") {
    const entry = hidden.get(args.receipt);
    if (!entry || args.token !== entry.cleanup_token || args.expected_action !== entry.action) return {data: false, error: null};
    root.dataset.recovered = args.receipt;
    hidden.delete(args.receipt);
    return {data: true, error: null};
  }
  if (name === "list_simulator_sessions" && args.city === "nyc") return {data: [...records], error: null};
  if (name === "cancel_simulator_session" && args.session_id === id && records.length) {
    root.dataset.cancelCalls = String(Number(root.dataset.cancelCalls ?? 0) + 1);
    if (query.has("fail") && root.dataset.cancelCalls === "1") return {data: null, error: {message: "simulator_unavailable"}};
    records.length = 0;
    return {data: null, error: null};
  }
  throw new Error("Unexpected fixture call: " + name);
});
createRoot(root).render(
  <LocaleProvider>{query.has("recover") ? <SimulatorMembershipRecovery api={api} /> : <SimulatorSessions api={api} locationLabel={query.has("no-area") ? "   " : "New York, NY"} />}</LocaleProvider>,
);
