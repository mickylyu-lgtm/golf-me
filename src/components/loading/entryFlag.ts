// Who gets the branded entry (EntryOverlay):
// - everyone on a native build with the plain-green launch screen, i.e. one
//   that contains @capacitor/splash-screen (see hasNewLaunchScreen). Older
//   builds still show the old logo launch image, which would jump into the
//   overlay, so they keep the /splash page;
// - any installed app with the per-device test switch on (About -> tap the
//   version line 7 times, founder account only).
// The once-per-launch decision itself is made by the inline script in
// index.html (same two conditions), before the bundle runs, so the first
// frame is already green.
const TEST_KEY = "golfme:entryTest";
export const ENTRY_BOOT_CLASS = "gm-entry-boot";

// The native bridge defines Capacitor.Plugins.<jsName> at document start for
// every plugin compiled into the build, so this is known before any paint.
export function hasNewLaunchScreen(): boolean {
  try {
    const cap = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    return !!cap?.Plugins && Object.prototype.hasOwnProperty.call(cap.Plugins, "SplashScreen");
  } catch {
    return false;
  }
}

// Entry instead of the /splash page on this device.
export function isEntryEnabled(): boolean {
  return hasNewLaunchScreen() || isEntryTestEnabled();
}

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
