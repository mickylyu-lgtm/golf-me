import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Check, Eye, EyeOff, Mail } from "lucide-react";
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
import { AppleIcon } from "../components/icons/AppleIcon";
import { isAppleSignInCanceled, isNativeSocialSignInEnabled } from "../lib/socialSignIn";

interface AuthProps {
  mode: "login" | "signup";
}

// Must match Supabase Dashboard > Authentication > Providers > Email >
// "Email OTP Length". Drives the copy and when Verify enables; the field
// itself accepts up to Supabase's 10-digit maximum so a longer configured
// code is never truncated.
const EMAIL_OTP_LENGTH = 6;
const EMAIL_OTP_MAX_LENGTH = 10;
// Supabase's default minimum gap between sign-in emails to one address.
const RESEND_COOLDOWN_SECONDS = 60;

function isRateLimited(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { status, code } = err as { status?: number; code?: string };
  return status === 429 || (typeof code === "string" && code.startsWith("over_"));
}

export function Auth({ mode }: AuthProps) {
  const navigate = useNavigate();
  const { logIn } = useData();
  const { signInWithGoogle, signInWithApple, signInWithEmailOtp, verifyEmailOtp, signInWithPassword, authError, clearAuthError } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  // The demo account (mock data, localStorage only) is an internal/testing
  // entry point, hidden from the normal public login screen for launch. Open
  // /login?demo=1 to see it. App Review signs in with the dedicated password
  // account instead (scripts/setup-apple-review-account.ts).
  const [searchParams] = useSearchParams();
  const showDemoEntry = searchParams.has("demo");
  // Web-only way to reach the password sign-in for the App Review account; the
  // iOS app always shows the small link (no address bar there to add this).
  const showReviewEntry = searchParams.get("review") === "1";
  // Apple guideline 4.8: an iOS app that offers a third-party login such as
  // Google must also offer Sign in with Apple. The native app therefore shows
  // Google only together with Sign in with Apple, and only on a build that
  // has the native Apple plugin with the switch on (lib/socialSignIn.ts).
  // Every other native build keeps GolfMe's own sign-in only (email link +
  // code, password). The web keeps Google and never shows Apple.
  const isNativeApp = Capacitor.isNativePlatform();
  const showApple = isNativeApp && isNativeSocialSignInEnabled();
  const showGoogle = !isNativeApp || showApple;

  // With Apple/Google offered, email is a third equal button that opens the
  // box in place (one tap more for email users, a calmer screen that leads
  // with one-tap sign-in). Login without them (web is Google-only, so this
  // means an older native build) keeps the box open, since a lone "Continue
  // with Email" button there would just be an extra tap.
  const [showEmailField, setShowEmailField] = useState(mode === "login" && !showGoogle);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Set when the visitor arrives from a sign-in link that failed (expired,
  // already used on another device, or consumed by a mail scanner).
  const [linkFailed, setLinkFailed] = useState(false);

  // A sign-in link that came back invalid/expired used to fail silently.
  // otp_expired (Supabase's code for both expired and already-used links)
  // gets a lasting notice pointing at a new link + code; anything else a
  // translated toast.
  useEffect(() => {
    if (!authError) return;
    if (authError === "otp_expired") {
      setLinkFailed(true);
      setShowEmailField(true);
    } else {
      showToast(t("auth.authError"), "warning");
    }
    clearAuthError();
  }, [authError, clearAuthError, showToast, t]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);
  // Secondary, low-visibility path alongside Google/magic-link -- for
  // accounts that need a fixed, typeable credential rather than an inbox or
  // a Google account (Apple's App Review reviewer is the reason this
  // exists; regular users have no reason to notice or use it).
  const [showPasswordField, setShowPasswordField] = useState(mode === "login" && showReviewEntry);
  const [passwordEmail, setPasswordEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function continueWithGoogle() {
    setBusy(true);
    try {
      await signInWithGoogle();
      // On WEB this really does navigate the whole page away (component
      // unmounts, so resetting busy would be moot) -- but on native,
      // signInWithGoogle() just opens the in-app browser as a separate
      // overlay and returns immediately; this component stays mounted
      // underneath the whole time. Without the finally below, closing that
      // browser without completing sign-in (reported live) left this
      // button permanently disabled — busy was never reset because
      // nothing here ever threw, and there was no unmount to make it moot.
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
    } finally {
      setBusy(false);
    }
  }

  async function continueWithApple() {
    setBusy(true);
    try {
      await signInWithApple();
      // Success: onAuthStateChange in AuthContext takes over.
    } catch (err) {
      // Closing Apple's sheet is a normal choice, not an error.
      if (!isAppleSignInCanceled(err)) {
        console.error("GolfMe: Sign in with Apple failed.", err);
        showToast(t("auth.authError"), "warning");
      }
    } finally {
      setBusy(false);
    }
  }

  async function continueWithEmail() {
    if (!email.includes("@")) return;
    setBusy(true);
    try {
      await signInWithEmailOtp(email.trim());
      if (emailSent) showToast(t("auth.code.resent"), "success");
      setEmailSent(true);
      setLinkFailed(false);
      setCode("");
      setCodeError(null);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      if (isRateLimited(err)) {
        showToast(t("auth.code.rateLimited"), "warning");
        if (emailSent) setResendCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (code.length < EMAIL_OTP_LENGTH || busy) return;
    setBusy(true);
    setCodeError(null);
    try {
      await verifyEmailOtp(email.trim(), code);
      // Success: onAuthStateChange in AuthContext takes over, as for the link.
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setCodeError(
        isRateLimited(err)
          ? t("auth.code.rateLimited")
          : status === 400 || status === 403 || status === 422
            ? t("auth.code.invalid")
            : t("auth.authError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function continueWithPassword() {
    if (!passwordEmail.includes("@") || !password) return;
    setBusy(true);
    try {
      await signInWithPassword(passwordEmail.trim(), password);
      // No further action on success — the onAuthStateChange listener in
      // AuthContext picks up the new session and App.tsx's route guards
      // take it from there, same as every other sign-in method here.
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("auth.authError"), "warning");
    } finally {
      setBusy(false);
    }
  }

  function useDifferentMethod() {
    setEmailSent(false);
    setCode("");
    setCodeError(null);
    // Same as the initial state: back to the buttons when Apple/Google show.
    setShowEmailField(mode === "login" && !showGoogle);
    setEmail("");
    setShowPasswordField(false);
    setPasswordEmail("");
    setPassword("");
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
          {/* Gradient variant, rendered at full chip size -- same fix and
              same reasoning as Splash.tsx (see GolfMeIcon's own comment
              on why a smaller inset icon over a separate chip background
              left a visible seam even with matching colors). */}
          {/* mx-auto: text-center on the parent only centers inline content
              -- Tailwind's preflight makes svg display:block, so without
              this the icon sits left-aligned regardless of text-center
              (reported live). Splash.tsx doesn't need this since its
              parent centers via flexbox instead. */}
          <GolfMeIcon size={48} variant="gradient" className="mx-auto mb-4 rounded-2xl" />
          <h1 className="text-2xl font-extrabold text-slate-900">
            {mode === "signup" ? t("auth.createAccount") : t("auth.signIn")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{mode === "signup" ? t("auth.signupSubtitle") : t("auth.loginSubtitle")}</p>
        </div>

        {emailSent ? (
          <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
              <Mail size={22} />
            </span>
            <h2 className="text-base font-bold text-slate-900">{t("auth.checkEmailTitle")}</h2>
            <p className="break-words text-sm text-slate-500">{t("auth.code.checkEmailBody", { email, count: EMAIL_OTP_LENGTH })}</p>
            {/* Code from the same email: signs in on THIS device, whichever device the email was opened on. */}
            <form onSubmit={verifyCode} className="mt-1 flex w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left">
              <label htmlFor="email-otp" className="text-xs font-semibold text-slate-600">
                {t("auth.code.label", { count: EMAIL_OTP_LENGTH })}
              </label>
              <input
                id="email-otp"
                name="one-time-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={code}
                // Strips spaces/dashes from a pasted "123 456"; no maxLength
                // attribute, since that would truncate the paste before this runs.
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, EMAIL_OTP_MAX_LENGTH));
                  setCodeError(null);
                }}
                placeholder={"0".repeat(EMAIL_OTP_LENGTH)}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? "email-otp-error" : undefined}
                className={`${inputClass} min-h-11 text-center font-mono text-xl tracking-[0.3em] placeholder:text-slate-300`}
              />
              {codeError && (
                <p id="email-otp-error" role="alert" className="text-xs leading-relaxed text-red-600">
                  {codeError}
                </p>
              )}
              <Button type="submit" disabled={code.length < EMAIL_OTP_LENGTH || busy} fullWidth className="min-h-11">
                {t("auth.code.verify")}
              </Button>
            </form>
            <button
              onClick={() => continueWithEmail()}
              disabled={busy || resendCooldown > 0}
              className="min-h-11 px-3 text-xs font-semibold text-fairway-700 hover:underline disabled:text-slate-400 disabled:no-underline"
            >
              {resendCooldown > 0 ? t("auth.code.resendIn", { seconds: resendCooldown }) : t("auth.code.resend")}
            </button>
            <button
              onClick={useDifferentMethod}
              className="-mt-2 min-h-11 px-3 text-xs font-semibold text-slate-400 hover:text-slate-600 hover:underline"
            >
              {t("auth.useDifferentMethod")}
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
            {linkFailed && (
              <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left">
                <p className="text-sm font-semibold text-amber-900">{t("auth.code.linkExpiredTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  {t("auth.code.linkExpiredBody", { count: EMAIL_OTP_LENGTH })}
                </p>
              </div>
            )}
            {/* Apple HIG: black button, white logo and title, at least as prominent as the other buttons, so it goes first. */}
            {showApple && (
              <button
                onClick={continueWithApple}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none disabled:opacity-50"
              >
                <AppleIcon size={17} /> {mode === "signup" ? t("auth.continueWithApple") : t("auth.signInWithApple")}
              </button>
            )}
            {showGoogle && (
              <button
                onClick={continueWithGoogle}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none disabled:opacity-50"
              >
                <GoogleIcon size={16} /> {t("auth.continueWithGoogle")}
              </button>
            )}

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
                  autoFocus={mode !== "login" || showGoogle}
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

            {mode === "login" && showDemoEntry && (
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

            {/* Always shown in the iOS app: App Review signs in with the password account there and can't add ?demo=1.
                On the web it stays behind ?demo=1 as before. */}
            {mode === "login" && (showDemoEntry || showReviewEntry || isNativeApp) && (
              <>
                {!showPasswordField ? (
                  <button
                    onClick={() => setShowPasswordField(true)}
                    className="mt-1 self-center text-xs font-semibold text-slate-400 transition-colors duration-200 hover:text-slate-600"
                  >
                    {t("auth.signInWithPassword")}
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <input
                      type="email"
                      value={passwordEmail}
                      onChange={(e) => setPasswordEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                    <div className="relative">
                      <input
                        type={passwordVisible ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("auth.passwordPlaceholder")}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={`${inputClass} pr-12`}
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordVisible((v) => !v)}
                        aria-label={t(passwordVisible ? "auth.hidePassword" : "auth.showPassword")}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
                      >
                        {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <Button onClick={continueWithPassword} disabled={!passwordEmail.includes("@") || !password || busy} fullWidth>
                      {t("auth.signIn")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Terms acceptance (App Store Guideline 1.2): every sign-in path here can create an account, so both screens show it.
            Template placeholders keep each language's word order; the links are real buttons, not concatenated strings. */}
        <p className="text-center text-xs leading-relaxed text-slate-400">
          {t("auth.legalAgreement")
            .split(/(\{terms\}|\{privacy\})/)
            .map((part, i) =>
              part === "{terms}" ? (
                <button key={i} onClick={() => navigate("/terms")} className="font-semibold text-slate-500 underline hover:text-slate-700">
                  {t("auth.termsLink")}
                </button>
              ) : part === "{privacy}" ? (
                <button key={i} onClick={() => navigate("/privacy")} className="font-semibold text-slate-500 underline hover:text-slate-700">
                  {t("auth.privacyLink")}
                </button>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </p>

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
