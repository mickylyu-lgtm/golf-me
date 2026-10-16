// Test switch for the branded entry (EntryOverlay). Off by default, so
// everyone else keeps today's launch (the /splash page) until it's verified
// on a real iPhone. Per device: About -> tap the version line 7 times.
// The once-per-launch decision itself is made by the inline script in
// index.html, before the bundle runs, so the first frame is already green.
const TEST_KEY = "golfme:entryTest";
export const ENTRY_BOOT_CLASS = "gm-entry-boot";

export function isEntryTestEnabled(): boolean {
  try {
    return window.localStorage.getItem(TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setEntryTestEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(TEST_KEY, "1");
    else window.localStorage.removeItem(TEST_KEY);
  } catch {
    // Storage unavailable: the switch just doesn't stick.
  }
}

// True when index.html's script chose to play the entry on this page load.
export const SHOW_ENTRY = typeof document !== "undefined" && document.documentElement.classList.contains(ENTRY_BOOT_CLASS);
