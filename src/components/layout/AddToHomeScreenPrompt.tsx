import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../i18n/LocaleContext";
import { isStandalone } from "../../lib/pwa";

const DISMISSED_KEY = "golfme:a2hsDismissed";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

// Real accounts only browsing in a plain Safari tab genuinely lose their
// session after about a week of inactivity (iOS's own storage-eviction
// policy for sites not installed to the home screen — no app code can
// override that). Installing sidesteps it entirely, so this nudges toward
// that rather than just explaining the problem after the fact. iOS has no
// programmatic install API (no beforeinstallprompt) — Share > Add to Home
// Screen is a manual step only the user can take, so this can only show
// instructions, never trigger it directly. Android/desktop Chrome DO
// support beforeinstallprompt, so those get a real one-tap Install button.
export function AddToHomeScreenPrompt({ forceShow = false }: { forceShow?: boolean } = {}) {
  const { isDemo, authUser } = useAuth();
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(DISMISSED_KEY) === "1");
  const [installEvent, setInstallEvent] = useState<Event | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallEvent(e);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  // forceShow is for Settings' own "Add to Home Screen" row -- someone who
  // already dismissed the auto-nudge on Home once shouldn't be permanently
  // unable to find these instructions again just because they tapped the X.
  // isStandalone/isDemo/authUser stay real gates either way (nothing to
  // show someone who's already installed it, in demo mode, or signed out).
  if (isDemo || !authUser || isStandalone() || (dismissed && !forceShow)) return null;
  const ios = isIOS();
  if (!ios && !installEvent) return null; // nothing actionable to show elsewhere

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function handleAndroidInstall() {
    const promptEvent = installEvent as (Event & { prompt: () => Promise<void> }) | null;
    if (!promptEvent) return;
    await promptEvent.prompt();
    dismiss();
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/60 p-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-fairway-700 shadow-sm">
        {ios ? <Share size={16} /> : <SquarePlus size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">{t("a2hs.title")}</p>
        <p className="text-xs text-slate-500">{ios ? t("a2hs.iosInstructions") : t("a2hs.androidInstructions")}</p>
      </div>
      {!ios && installEvent && (
        <button
          onClick={handleAndroidInstall}
          className="shrink-0 rounded-full bg-fairway-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fairway-700"
        >
          {t("a2hs.install")}
        </button>
      )}
      <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <X size={14} />
      </button>
    </div>
  );
}
