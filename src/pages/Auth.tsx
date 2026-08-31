import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Mail } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { isStandalone } from "../lib/pwa";
import { Button } from "../components/ui/Button";
import { inputClass } from "../components/ui/FormControls";
import { DEFAULT_CURRENT_USER_ID } from "../data/golfers";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { GoogleIcon } from "../components/icons/GoogleIcon";

interface AuthProps {
  mode: "login" | "signup";
}

export function Auth({ mode }: AuthProps) {
  const navigate = useNavigate();
  const { logIn, session } = useData();
  const { signInWithGoogle, signInWithEmailOtp } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [showEmailField, setShowEmailField] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function continueWithGoogle() {
    setBusy(true);
    try {
      await signInWithGoogle();
      // No further action here on success — signInWithGoogle() redirects the
      // whole page to Google, so this component unmounts. The post-redirect
      // route guards (App.tsx) decide where a returning session lands.
    } catch (err) {
      setBusy(false);
      showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
    }
  }

  async function continueWithEmail() {
    if (!email.includes("@")) return;
    setBusy(true);
    try {
      await signInWithEmailOtp(email.trim());
      setEmailSent(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
    } finally {
      setBusy(false);
    }
  }

  function loginAsDemo() {
    logIn(DEFAULT_CURRENT_USER_ID);
    showToast(t("auth.signedInAs", { name: t("auth.demoAccountLabel", { name: "Jordan" }) }), "success");
    navigate("/");
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-[#faf9f6] px-6 pb-8"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}
    >
      {!isStandalone() && (
        // No Back button at all on the native/installed app -- there's
        // nothing to go back TO there anymore. The marketing Welcome page
        // (the waitlist pitch) is deliberately mobile-web-only now, so
        // sending a native visitor "back" to it would resurface a page
        // they were never meant to see and can't get back out of the same
        // way. Regular web visitors still have Welcome, so they keep Back.
        <button
          onClick={() => navigate("/welcome")}
          className="flex items-center gap-1.5 self-start text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {t("auth.back")}
        </button>
      )}

      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-fairway-600">
            <GolfMeIcon size={26} dotColor="#f8faf8" flagColor="#4ade80" holeColor="#14532d" />
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {mode === "signup" ? t("auth.createAccount") : session.hasOnboarded ? t("auth.welcomeBack") : t("auth.logIn")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{mode === "signup" ? t("auth.signupSubtitle") : t("auth.loginSubtitle")}</p>
        </div>

        {emailSent ? (
          <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
              <Mail size={22} />
            </span>
            <h2 className="text-base font-bold text-slate-900">{t("auth.checkEmailTitle")}</h2>
            <p className="text-sm text-slate-500">{t("auth.checkEmailBody", { email })}</p>
            <button
              onClick={() => continueWithEmail()}
              disabled={busy}
              className="mt-1 text-xs font-semibold text-fairway-700 hover:underline disabled:opacity-50"
            >
              {t("auth.resendEmail")}
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
            <button
              onClick={continueWithGoogle}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none disabled:opacity-50"
            >
              <GoogleIcon size={16} /> {t("auth.continueWithGoogle")}
            </button>

            {!showEmailField ? (
              <button
                onClick={() => setShowEmailField(true)}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                <Mail size={16} /> {t("auth.continueWithEmail")}
              </button>
            ) : (
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
                <Button onClick={continueWithEmail} disabled={!email.includes("@") || busy} fullWidth>
                  {t("auth.sendMagicLink")}
                </Button>
              </div>
            )}

            {mode === "login" && (
              <>
                <div className="my-1 flex items-center gap-3 text-xs font-medium text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  {t("common.or")}
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <button
                  onClick={loginAsDemo}
                  className="flex items-center justify-center gap-2 rounded-full border border-dashed border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-400 hover:bg-slate-50 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  <Check size={16} /> {t("auth.tryDemoAccount")}
                </button>
              </>
            )}
          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          {mode === "signup" ? (
            <>
              {t("auth.alreadyHaveAccount")}{" "}
              <button onClick={() => navigate("/login")} className="font-semibold text-fairway-700 hover:underline">
                {t("welcome.logIn")}
              </button>
            </>
          ) : (
            <>
              {t("auth.newHere")}{" "}
              <button onClick={() => navigate("/onboarding")} className="font-semibold text-fairway-700 hover:underline">
                {t("welcome.getStarted")}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
