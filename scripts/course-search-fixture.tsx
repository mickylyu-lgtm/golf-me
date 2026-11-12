// Local-only actual component fixture, never imported by production.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { CourseAutocomplete } from "../src/components/golfcall/CourseAutocomplete";
import "../src/index.css";
function Fixture() {
  const [value,setValue] = useState("");
  const [picked,setPicked] = useState("");
  const [mounted,setMounted] = useState(true);
  (window as unknown as {unmountSearch: () => void}).unmountSearch = () => setMounted(false);
  return <><style>{"@media (max-height:500px){ header{height:64px!important} main{padding-top:84px!important} }"}</style><header style={{position:"fixed",top:0,height:100,left:0,right:0,zIndex:10,background:"#fafaf7",padding:24}}>GolfMe</header>
  <main style={{padding:"120px 16px 30px", maxWidth:600,margin:"auto"}}>
    <h1>Host a Round</h1><p style={{marginBottom:24}}>Step 1 of 5: Where are you playing?</p>
    {mounted && <div style={{padding:16,border:"1px solid #eee",borderRadius:16}}>
      <CourseAutocomplete value={value} onChange={setValue} onPickKnownCourse={p=>setPicked(p.name)} inlineSuggestions />
    </div>}
    <p data-picked>{picked}</p><button>Continue</button>
  </main><div id="keyboard" style={{display:"none",position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"#d5d8df",padding:20}}>Synthetic keyboard (test only)</div></>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><Fixture /></LocaleProvider></StrictMode>);
