import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "../i18n/LocaleContext";
import { GolfMeLogo } from "../components/brand/GolfMeLogo";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { isFounder } from "../lib/founder";
import { isEntryTestEnabled, setEntryTestEnabled } from "../components/loading/entryFlag";
import { isNativeAppleSignInAvailable, isSocialSignInTestEnabled, setSocialSignInTestEnabled } from "../lib/socialSignIn";
import { goBack } from "../lib/goBack";

// Private per-device test switch for the branded launch entry (entryFlag.ts):
// 7 taps on the version line within a few seconds, and only while signed in
// to the founder account (real, not demo) -- for anyone else the taps do
// nothing. Developer-only, so the toast is not translated.
const ENTRY_TOGGLE_TAPS = 7;
const ENTRY_TOGGLE_WINDOW_MS = 3000;

export function About() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { showToast } = useToast();
  const { authUser, isDemo } = useAuth();
  const canToggleEntry = !isDemo && !!authUser && isFounder(authUser.id);
  const taps = useRef<number[]>([]);

  function onVersionTap() {
    if (!canToggleEntry) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < ENTRY_TOGGLE_WINDOW_MS), now];
    if (taps.current.length < ENTRY_TOGGLE_TAPS) return;
    taps.current = [];
    const on = !isEntryTestEnabled();
    setEntryTestEnabled(on);
    showToast(on ? "Entry animation test ON. Fully quit and reopen the app." : "Entry animation test OFF.", "info");
  }

  // Same gesture on the logo: the per-device test switch for native Sign in
  // with Apple + Google (lib/socialSignIn.ts). Only does anything on a build
  // that has the Apple plugin; sign out to see the buttons.
  const logoTaps = useRef<number[]>([]);
  function onLogoTap() {
    if (!canToggleEntry) return;
    const now = Date.now();
    logoTaps.current = [...logoTaps.current.filter((at) => now - at < ENTRY_TOGGLE_WINDOW_MS), now];
    if (logoTaps.current.length < ENTRY_TOGGLE_TAPS) return;
    logoTaps.current = [];
    if (!isNativeAppleSignInAvailable()) {
      showToast("This build has no native Sign in with Apple.", "info");
      return;
    }
    const on = !isSocialSignInTestEnabled();
    setSocialSignInTestEnabled(on);
    showToast(on ? "Apple + Google sign-in test ON. Sign out to see it." : "Apple + Google sign-in test OFF.", "info");
  }

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => goBack(navigate)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("common.back")}
      </button>

      <div className="flex flex-col items-start gap-4">
        <div className="select-none" onClick={onLogoTap}>
          <GolfMeLogo interactive={false} size={22} />
        </div>
        <p className="text-sm text-slate-600">{t("about.description")}</p>
        <p className="select-none text-xs text-slate-400" onClick={onVersionTap}>
          {t("about.version")}
        </p>
      </div>
    </div>
  );
}
