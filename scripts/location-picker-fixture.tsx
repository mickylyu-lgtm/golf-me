// Local-only fixture for the actual picker. No real account or location calls.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { LocationPicker } from "../src/components/location/LocationPicker";
import "../src/index.css";
export function Fixture() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  return <main style={{ padding: 24 }}>
    <h1>Host a Round</h1>
    <button onClick={() => setOpen(true)}>Choose course location</button>
    <p data-picked>{picked}</p>
    {open && <LocationPicker title="Where is the course?" onClose={() => setOpen(false)} onSelect={area => { setPicked(area.label); setOpen(false); }} />}
    <div id="keyboard" style={{ display: "none" }}>Simulated keyboard area — browser test</div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><Fixture /></LocaleProvider></StrictMode>);
