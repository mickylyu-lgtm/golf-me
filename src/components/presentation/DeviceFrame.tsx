import type { ReactNode } from "react";
import { usePresentation } from "../../context/PresentationContext";

// Wraps the live app in a laptop or phone bezel for demos/screenshots. The
// app inside stays fully real and responsive — this is layout chrome only,
// no photorealism/reflections, and "none" (the default) renders children
// with zero extra wrapper markup so it can never affect normal usage.
export function DeviceFrame({ children }: { children: ReactNode }) {
  const { frameMode } = usePresentation();

  if (frameMode === "none") return <>{children}</>;

  if (frameMode === "mobile") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="relative flex h-[85vh] max-h-[820px] w-[390px] max-w-full flex-col overflow-hidden rounded-[2.75rem] border-[10px] border-slate-800 bg-slate-800 shadow-2xl">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 z-10 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-slate-800"
          />
          <div className="no-scrollbar flex-1 overflow-y-auto rounded-[2rem] bg-[#faf8f2]">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="flex w-full max-w-6xl flex-col items-center">
        <div className="w-full overflow-hidden rounded-t-2xl border-4 border-b-0 border-slate-800 bg-slate-800 shadow-2xl">
          <div aria-hidden="true" className="flex items-center gap-1.5 px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          </div>
          <div className="h-[75vh] overflow-y-auto bg-[#faf8f2]">{children}</div>
        </div>
        <div aria-hidden="true" className="h-4 w-[92%] rounded-b-xl bg-slate-700" />
        <div aria-hidden="true" className="h-1.5 w-[55%] rounded-b-md bg-slate-600" />
      </div>
    </div>
  );
}
