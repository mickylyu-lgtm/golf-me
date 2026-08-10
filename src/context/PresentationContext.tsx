import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type FrameMode = "none" | "desktop" | "mobile";

const STORAGE_KEY = "golfme_presentation_frame";

interface PresentationContextValue {
  frameMode: FrameMode;
  setFrameMode: (mode: FrameMode) => void;
}

const PresentationContext = createContext<PresentationContextValue | null>(null);

function loadFrameMode(): FrameMode {
  if (typeof window === "undefined") return "none";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "desktop" || stored === "mobile" ? stored : "none";
}

// Presentation Mode is a demo/screenshot aid only — wraps the live,
// fully-functional app in an on-screen laptop/phone frame for showing
// testers/investors. Never changes production behavior or layout when off
// (the default); persisted locally only so the choice survives a reload
// mid-demo.
export function PresentationProvider({ children }: { children: ReactNode }) {
  const [frameMode, setFrameModeState] = useState<FrameMode>(loadFrameMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, frameMode);
  }, [frameMode]);

  return <PresentationContext.Provider value={{ frameMode, setFrameMode: setFrameModeState }}>{children}</PresentationContext.Provider>;
}

export function usePresentation(): PresentationContextValue {
  const ctx = useContext(PresentationContext);
  if (!ctx) throw new Error("usePresentation must be used within a PresentationProvider");
  return ctx;
}
