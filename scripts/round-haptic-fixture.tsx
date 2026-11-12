// Synthetic hook/card fixture. Never imported by the app.
import { StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { useRoundCelebration } from "../src/lib/useRoundCelebration";
import { RoundCompleteCelebration } from "../src/components/golfcall/RoundCompleteCelebration";
import "../src/index.css";

type State = { id: string; userId: string; status: string; member: boolean; dateISO: string; mounted: boolean };
const w = window as unknown as { __gmTapHaptics: string[]; qa: Record<string, any> };
w.__gmTapHaptics = [];
const initial: State = { id: "round-1", userId: "host", status: "open", member: true, dateISO: new Date().toISOString(), mounted: true };
export function Subject({ state }: { state: State }) {
  const { celebrate, celebrating, done } = useRoundCelebration({ id: state.id, status: state.status, dateISO: state.dateISO }, state.userId, state.member);
  useLayoutEffect(() => { w.qa.celebrate = celebrate; w.qa.done = done; }, [celebrate, done]);
  return <><span data-testid="celebrating">{String(celebrating)}</span>{celebrating && <RoundCompleteCelebration onDone={done} />}</>;
}
export function Fixture() {
  const [state, setState] = useState(initial);
  useLayoutEffect(() => {
    w.qa = { ...w.qa, set: (next: Partial<State>) => setState(s => ({ ...s, ...next })) };
  }, []);
  return <main>{state.mounted && <Subject state={state} />}</main>;
}
w.qa = {};
createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><Fixture /></LocaleProvider></StrictMode>);
