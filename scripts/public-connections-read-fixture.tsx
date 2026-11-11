// Synthetic only. Not imported by application.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { useConnectionPages } from "../src/lib/useConnectionPages";
import type { ConnectionCursor, ConnectionPage } from "../src/lib/socialPrivacy";
const pending: { cursor: ConnectionCursor | null; resolve: (value: ConnectionPage) => void; reject: (error: Error) => void }[] = [];
function Fixture() {
  const [scope, setScope] = useState(0);
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(true);
  const read = useCallback((cursor: ConnectionCursor | null) => {
    void scope; void query;
    return new Promise<ConnectionPage>((resolve,reject)=>pending.push({cursor,resolve,reject}));
  }, [scope,query]);
  const { value,failed,busy,retry,loadMore }=useConnectionPages(read,enabled);
  return <div><button onClick={()=>setScope(n=>n+1)}>Change scope</button><input aria-label="Search fixture" value={query} onChange={e=>setQuery(e.target.value)}/>
    <button onClick={()=>setEnabled(v=>!v)}>Toggle access</button><button onClick={retry}>Retry</button><button disabled={busy} onClick={loadMore}>More</button>
    <div data-testid="page-state">{!enabled ? "hidden" : failed ? "error" : !value ? "loading" : value.golfers.map(g=>g.id).join(",")}</div></div>;
}
export function mountPageFixture(){
  const el=document.createElement("div");document.body.append(el);const root=createRoot(el);root.render(<Fixture/>);
  return {count:()=>pending.length,cursor:(i:number)=>pending[i].cursor,resolve:(i:number,ids:string[],nextCursor:ConnectionCursor|null=null)=>pending[i].resolve({total:100,matchedTotal:100,mutualTotal:0,mutualIds:[],golfers:ids.map(id=>({id,name:id})) as ConnectionPage["golfers"],nextCursor}),reject:(i:number)=>pending[i].reject(new Error("Synthetic denied")),unmount:()=>{root.unmount();el.remove();}};
}
