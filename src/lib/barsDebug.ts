// Opt-in readout of the baked-in black-bar scan on swing videos (2026-10-26:
// bars on one feed video still showed on Micky's iPhone after two fixes, and
// the iOS app has no console). Visiting any page with ?barsdebug=1 turns it
// on for this device, ?barsdebug=0 turns it off. Off: nothing is shown.

const STORAGE_KEY = "gmBarsDebug";

function readFlag(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("barsdebug");
    if (param === "1" || param === "0") window.localStorage.setItem(STORAGE_KEY, param);
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const barsDebugEnabled = typeof window !== "undefined" && readFlag();

/** The running bundle's file name, so a screenshot shows which build it is. */
export function buildTag(): string {
  const src = Array.from(document.scripts).find((s) => /\/assets\/index-[^/]+\.js/.test(s.src))?.src;
  return src ? src.slice(src.lastIndexOf("/") + 1) : "dev";
}
