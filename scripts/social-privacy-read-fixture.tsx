/* eslint-disable react/only-export-components -- Standalone browser test bootstrap, not an application component module. */
// Browser-only synthetic test fixture. Never imported by the application.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { useSocialRead } from "../src/lib/useSocialRead";
const pending: { resolve: (value: string[]) => void; reject: (error: Error) => void }[] = [];
function Fixture() {
  const [viewer, setViewer] = useState("a");
  const [enabled, setEnabled] = useState(true);
  const read = useCallback(() => {
    void viewer;
    return new Promise<string[]>((resolve, reject) => pending.push({ resolve, reject }));
  }, [viewer]);
  const { value, failed, retry } = useSocialRead(read, enabled);
  return <div>
    <button onClick={() => setViewer((v) => v === "a" ? "b" : "a")}>Switch viewer</button>
    <button onClick={() => setEnabled((v) => !v)}>Toggle access</button>
    <button onClick={retry}>Retry</button>
    <div data-testid="read-state">{!enabled ? "private" : failed ? "error" : value === undefined ? "loading" : value.join(",")}</div>
  </div>;
}
export function mountFixture() {
  const element = document.createElement("div"); document.body.appendChild(element);
  const root = createRoot(element); root.render(<Fixture />);
  return {
    pendingCount: () => pending.length,
    resolve: (index: number, value: string[]) => pending[index].resolve(value),
    reject: (index: number) => pending[index].reject(new Error("Synthetic unavailable")),
    unmount: () => { root.unmount(); element.remove(); },
  };
}
