import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { ArrowLeft, Check, ChevronLeft, Eye, EyeOff, Info, Loader2, Mail } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { isStandalone } from "../lib/pwa";
import { Button } from "../components/ui/Button";
import { inputClass } from "../components/ui/FormControls";
import { DEFAULT_CURRENT_USER_ID } from "../data/golfers";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { GolfMeWordmark } from "../components/brand/GolfMeWordmark";
import { GoogleIcon } from "../components/icons/GoogleIcon";
import { AppleIcon } from "../components/icons/AppleIcon";
import { CodeInput } from "../components/auth/CodeInput";
import { isAppleSignInCanceled, isNativeSocialSignInEnabled, isWebAppleSignInEnabled } from "../lib/socialSignIn";
import { AUTH_ERROR_MESSAGE_KEY, authErrorKind, clearEmailDraft, isValidEmail, loadEmailDraft, normalizeEmail, saveEmailDraft, sendCodeErrorKey } from "../lib/authInput";
import {
  classifyAuthNotice,
  createRequestGate,
  gatedRequest,
  resendSecondsLeft,
  shouldAutoSubmit,
  watchResendCountdown,
} from "../lib/emailCodeFlow";
import { track } from "../lib/analytics";
import { WELCOME_PHOTO } from "../lib/welcomeImagery";

interface AuthProps {
  mode: "login" | "signup";
}

// Must match Supabase Dashboard > Authentication > Providers > Email >
// "Email OTP Length": the code screen shows this many boxes and submits
// once they're all filled.
const EMAIL_OTP_LENGTH = 6;

type Step = "welcome" | "email" | "code";

// One screen for sign-in and sign-up (/login, /signup): the email code
// creates the account the first time, and the route guards in App.tsx send
// a new account to /profile-setup and a returning one straight in.
//   welcome  photo, logo, headline, Apple / Google / Email
//   email    "Enter your email" -> Send code
//   code     six boxes, auto-submit, resend countdown, Change email
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
  // Every other native build keeps GolfMe's own sign-in only (email code,
  // password). The web shows Google, and Apple only once its web setup is
  // done (VITE_APPLE_WEB_SIGN_IN).
  const isNativeApp = Capacitor.isNativePlatform();
  const showApple = isNativeApp ? isNativeSocialSignInEnabled() : isWebAppleSignInEnabled();
  const showGoogle = !isNativeApp || showApple;
  const hasSocial = showApple || showGoogle;

  // The email box's contents survive leaving this screen (Terms/Privacy, or
  // iOS reloading the page after a trip to the Mail app) for the rest of the
  // browser session: see EmailDraft in lib/authInput. Without Apple/Google
  // (an older native build) the welcome step would be a lone Email button,
  // so it starts at the email step.
  const [initialDraft] = useState(() => loadEmailDraft());
  const [showEmailField, setShowEmailField] = useState(initialDraft?.open || !hasSocial);
  const [email, setEmail] = useState(initialDraft?.email ?? "");
  const [emailTouched, setEmailTouched] = useState(false);
  // The code screen is bound to the address actually submitted (sentTo),
  // never to the field: the field can't change while sending, and a
  // response that arrives after "Change email" / "Use a different method"
  // is stale and ignored (request gates below).
  const [sentAt, setSentAt] = useState<number | null>(initialDraft?.sentAt ?? null);
  const [sentTo, setSentTo] = useState<string | null>(initialDraft?.sentTo ?? null);
  const emailSent = sentAt !== null && sentTo !== null;
  const step: Step = emailSent ? "code" : showEmailField ? "email" : "welcome";
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Refs, not state: a second tap in the same frame still sees busy false.
  const sendGate = useRef(createRequestGate()).current;
  const verifyGate = useRef(createRequestGate()).current;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  // The last code sent for verification: auto-submit fires once per code,
  // so a wrong one isn't re-sent by itself.
  const lastSubmittedCode = useRef<string | null>(null);
  const emailValid = isValidEmail(email);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const focusEmailOnMount = useRef(false);

  // Resend countdown: computed from when it started (the send, or a "too
  // many requests" answer) and the clock, never counted down by ticks, so a
  // trip to Mail (timers paused in the background) doesn't add waiting time.
  // `now` is re-read every second while counting and on every resume.
  const [rateLimitedAt, setRateLimitedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // rateLimitedAt is cleared by every successful send, so when set it is the
  // newer event (compared by order, not timestamps, which skew can reorder).
  const cooldownFrom = emailSent ? (rateLimitedAt ?? sentAt) : null;
  const resendLeft = resendSecondsLeft(cooldownFrom, now);

  useEffect(() => {
    saveEmailDraft({ email, open: showEmailField, sentAt, sentTo });
  }, [email, showEmailField, sentAt, sentTo]);

  useEffect(() => {
    track("login_viewed", { mode });
  }, [mode]);

  // Set when the visitor arrives from a sign-in link that failed (expired,
  // already used on another device, or consumed by a mail scanner).
  const [linkFailed, setLinkFailed] = useState(false);
  // Set when the session ended by itself (AuthContext's "session_expired").
  const [sessionExpired, setSessionExpired] = useState(false);

  // A sign-in link that came back invalid/expired used to fail silently.
  // otp_expired (Supabase's code for both expired and already-used links)
  // gets a lasting notice with a "Send a new code" action on whichever
  // screen is showing (the email box, or a restored code screen). Backing
  // out of Apple/Google is a choice, not an error. Anything else is a
  // translated toast, never Supabase's own text.
  useEffect(() => {
    const notice = classifyAuthNotice(authError);
    if (!notice) return;
    if (notice === "linkExpired") {
      setLinkFailed(true);
      setShowEmailField(true);
      track("auth_failed", { reason: "linkExpired" });
    } else if (notice === "sessionExpired") {
      setSessionExpired(true);
    } else if (notice === "other") {
      showToast(t("auth.authError"), "warning");
      track("auth_failed", { reason: "redirect" });
    }
    clearAuthError();
  }, [authError, clearAuthError, showToast, t]);

  useEffect(
    () =>
      watchResendCountdown(cooldownFrom, setNow, {
        now: () => Date.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
        // Same resume signals as lib/resumeRefetch + FoundingRevealHost:
        // visibility/focus (pageshow for a back-forward cache restore), and
        // the native app coming to the foreground.
        onResume: (fn) => {
          const onVisible = () => document.visibilityState === "visible" && fn();
          document.addEventListener("visibilitychange", onVisible);
          window.addEventListener("focus", fn);
          window.addEventListener("pageshow", fn);
          const native = Capacitor.isNativePlatform() ? CapacitorApp.addListener("appStateChange", ({ isActive }) => isActive && fn()) : null;
          return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", fn);
            window.removeEventListener("pageshow", fn);
            void native?.then((l) => l.remove());
          };
        },
      }),
    [cooldownFrom],
  );
  // Secondary, low-visibility path alongside Google/email -- for accounts
  // that need a fixed, typeable credential rather than an inbox or a Google
  // account (Apple's App Review reviewer is the reason this exists; regular
  // users have no reason to notice or use it).
  const [showPasswordField, setShowPasswordField] = useState(mode === "login" && showReviewEntry);
  const [passwordEmail, setPasswordEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function continueWithGoogle() {
    track("auth_google_selected");
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
      console.error("GolfMe: Google sign-in failed.", err);
      const kind = authErrorKind(err);
      track("auth_failed", { reason: `google_${kind}` });
      showToast(t(AUTH_ERROR_MESSAGE_KEY[kind]), "warning");
    } finally {
      setBusy(false);
    }
  }

  async function continueWithApple() {
    track("auth_apple_selected");
    setBusy(true);
    try {
      await signInWithApple();
      // Success: onAuthStateChange in AuthContext takes over (native), or
      // the page leaves for Apple (web).
    } catch (err) {
      // Closing Apple's sheet is a normal choice, not an error.
      if (!isAppleSignInCanceled(err)) {
        console.error("GolfMe: Sign in with Apple failed.", err);
        const kind = authErrorKind(err);
        track("auth_failed", { reason: `apple_${kind}` });
        showToast(t(kind === "network" || kind === "accountConflict" ? AUTH_ERROR_MESSAGE_KEY[kind] : "auth.appleFailed"), "warning");
      }
    } finally {
      setBusy(false);
    }
  }

  function chooseEmail() {
    track("auth_email_selected");
    setSessionExpired(false);
    setShowEmailField(true);
    focusEmailOnMount.current = true;
  }

  // Sends the sign-in email to `address` and, on success, binds the code
  // screen to it. One send at a time (double tap, Enter + tap); an answer
  // that arrives after the person left the code screen is ignored.
  async function sendCode(address: string, isResend: boolean) {
    if (sendGate.inFlight) return;
    if (isResend && resendSecondsLeft(cooldownFrom, Date.now()) > 0) return;
    setSending(true);
    const result = await gatedRequest(sendGate, () => signInWithEmailOtp(address));
    setSending(sendGate.inFlight);
    if (result.status === "busy" || result.status === "stale") return;
    if (result.status === "ok") {
      const at = Date.now();
      track("code_requested", { resend: isResend });
      if (isResend) showToast(t("auth.code.resent"), "success");
      setSentTo(address);
      setSentAt(at);
      setNow(at);
      setRateLimitedAt(null);
      setLinkFailed(false);
      setSessionExpired(false);
      setCode("");
      setCodeError(null);
      lastSubmittedCode.current = null;
      return;
    }
    const kind = authErrorKind(result.error);
    track("auth_failed", { reason: `send_${kind}` });
    if (kind !== "rateLimited") console.error("GolfMe: sending the sign-in email failed.", result.error);
    showToast(t(sendCodeErrorKey(kind)), "warning");
    if (kind === "rateLimited" && isResend) {
      const at = Date.now();
      setRateLimitedAt(at);
      setNow(at);
    }
  }

  function continueWithEmail(e?: FormEvent) {
    e?.preventDefault();
    setEmailTouched(true);
    if (!emailValid) return;
    void sendCode(normalizeEmail(email), false);
  }

  function resendCode() {
    if (sentTo) void sendCode(sentTo, true);
  }

  // Checks `candidate` against the bound address. Never logged anywhere.
  async function submitCode(candidate: string) {
    if (candidate.length < EMAIL_OTP_LENGTH || !sentTo || verifyGate.inFlight) return;
    const address = sentTo;
    lastSubmittedCode.current = candidate;
    setVerifying(true);
    setCodeError(null);
    const result = await gatedRequest(verifyGate, () => verifyEmailOtp(address, candidate));
    setVerifying(verifyGate.inFlight);
    // Success: onAuthStateChange in AuthContext takes over, as for the link.
    if (result.status !== "error") return;
    const err = result.error;
    const status = (err as { status?: number } | null)?.status;
    const kind = authErrorKind(err);
    // Supabase answers a wrong code and an expired one the same way (403
    // otp_expired), so one message covers both.
    const wrongOrExpired = kind !== "rateLimited" && kind !== "network" && (status === 400 || status === 403 || status === 422);
    track("auth_failed", { reason: wrongOrExpired ? "code_invalid" : `verify_${kind}` });
    setCodeError(wrongOrExpired ? t("auth.code.invalid") : t(kind === "rateLimited" || kind === "network" ? AUTH_ERROR_MESSAGE_KEY[kind] : "auth.authError"));
    // A wrong code is cleared so the next one can be typed straight in; a
    // network failure keeps it for "Sign in with code" to retry.
    if (wrongOrExpired) setCode("");
  }

  function onCodeChange(next: string) {
    setCode(next);
    if (codeError) setCodeError(null);
    if (shouldAutoSubmit(next, EMAIL_OTP_LENGTH, lastSubmittedCode.current)) void submitCode(next);
  }

  function verifyCode(e: FormEvent) {
    e.preventDefault();
    void submitCode(code);
  }

  // Leaves the code screen: whatever is in flight becomes stale.
  function leaveCodeScreen() {
    sendGate.cancel();
    verifyGate.cancel();
    setSending(false);
    setVerifying(false);
    setSentAt(null);
    setSentTo(null);
    setRateLimitedAt(null);
    setCode("");
    setCodeError(null);
    lastSubmittedCode.current = null;
  }

  // Back to the email box with the address that was used, ready to edit.
  function changeEmail() {
    const address = sentTo ?? email;
    leaveCodeScreen();
    setEmail(address);
    setEmailTouched(false);
    setShowEmailField(true);
    focusEmailOnMount.current = true;
  }

  // "Send a new code" in the failed-link notice on the email box.
  function sendNewCodeFromNotice() {
    setEmailTouched(true);
    if (emailValid) void sendCode(normalizeEmail(email), false);
    else emailInputRef.current?.focus();
  }

  async function continueWithPassword(e?: FormEvent) {
    e?.preventDefault();
    if (!isValidEmail(passwordEmail) || !password || busy) return;
    setBusy(true);
    try {
      await signInWithPassword(normalizeEmail(passwordEmail), password);
      // No further action on success — the onAuthStateChange listener in
      // AuthContext picks up the new session and App.tsx's route guards
      // take it from there, same as every other sign-in method here.
    } catch (err) {
      showToast(t(AUTH_ERROR_MESSAGE_KEY[authErrorKind(err)]), "warning");
    } finally {
      setBusy(false);
    }
  }

  // Back to the start (the welcome buttons, or the email box when there
  // are no Apple/Google buttons).
  function useDifferentMethod() {
    leaveCodeScreen();
    clearEmailDraft();
    setEmailTouched(false);
    setLinkFailed(false);
    setShowEmailField(!hasSocial);
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

  const legal = (
    // Terms acceptance (App Store Guideline 1.2): every sign-in path here can create an account, so every step shows it.
    // Template placeholders keep each language's word order; the links are real buttons, not concatenated strings.
    <p className="text-center text-xs leading-relaxed text-slate-400">
      {t("auth.legalAgreement")
        .split(/(\{terms\}|\{privacy\})/)
        .map((part, i) =>
          part === "{terms}" ? (
            <button key={i} type="button" onClick={() => navigate("/terms")} className="font-semibold text-slate-500 underline hover:text-slate-700">
              {t("auth.termsLink")}
            </button>
          ) : part === "{privacy}" ? (
            <button key={i} type="button" onClick={() => navigate("/privacy")} className="font-semibold text-slate-500 underline hover:text-slate-700">
              {t("auth.privacyLink")}
            </button>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
    </p>
  );

  // The demo account and the App Review password sign-in, on whichever step
  // comes first. Unchanged rules: demo only on /login?demo; password always
  // in the iOS app, on the web only with ?demo or ?review=1.
  const extraEntries = mode === "login" && (showDemoEntry || showReviewEntry || isNativeApp) && (
    <div className="flex flex-col gap-2">
      {showDemoEntry && (
        <button
          type="button"
          onClick={loginAsDemo}
          className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-dashed border-slate-300 px-5 text-sm font-semibold text-slate-700 transition-colors duration-200 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Check size={16} /> {t("auth.tryDemoAccount")}
        </button>
      )}
      {!showPasswordField ? (
        <button
          type="button"
          onClick={() => setShowPasswordField(true)}
          className="min-h-10 self-center px-3 text-xs font-semibold text-slate-400 transition-colors duration-200 hover:text-slate-600"
        >
          {t("auth.signInWithPassword")}
        </button>
      ) : (
        <form onSubmit={continueWithPassword} noValidate className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <input
            type="email"
            name="username"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t("auth.emailLabel")}
            value={passwordEmail}
            onChange={(e) => setPasswordEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <div className="relative">
            <input
              type={passwordVisible ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              aria-label={t("auth.passwordPlaceholder")}
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
          <Button type="submit" disabled={!isValidEmail(passwordEmail) || !password || busy} aria-busy={busy || undefined} fullWidth className="gap-2">
            {busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {t("auth.signIn")}
          </Button>
        </form>
      )}
    </div>
  );

  const methodButton =
    "flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-full px-5 text-[15px] font-semibold transition-all duration-200 ease-out active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-50";

  if (step === "welcome") {
    return (
      <div className="flex min-h-[100svh] flex-col bg-[#faf9f6]">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
          {/* Fixed-height photo band: nothing below moves while it loads. */}
          {/* Takes the height the content below doesn't need: ~170px on an iPhone SE, ~340px on a 6.1" phone. */}
          <div className="relative h-[clamp(150px,calc(100svh-500px),380px)] w-full shrink-0 overflow-hidden bg-brand-forest sm:rounded-b-[2rem]">
            {/* Photo from lib/welcomeImagery (one constant, swappable); the fixed band means no layout shift while it loads. */}
            <img
              src={WELCOME_PHOTO.src}
              alt=""
              width={WELCOME_PHOTO.width}
              height={WELCOME_PHOTO.height}
              decoding="async"
              fetchPriority="high"
              style={{ transformOrigin: WELCOME_PHOTO.focal, transform: `scale(${WELCOME_PHOTO.zoom})` }}
              className="absolute inset-0 h-full w-full object-cover saturate-[1.15]"
            />
            {/* Green wash for warmth + a fade into the page so the logo and text below never sit on busy imagery. */}
            <div className="absolute inset-0 bg-gradient-to-b from-brand-forest-deep/45 via-brand-forest/20 to-[#faf9f6]" aria-hidden />
            {!isStandalone() && (
              // No Back on the installed/native app: the marketing Welcome
              // page is mobile-web only, there's nothing to go back to.
              <button
                type="button"
                onClick={() => navigate("/welcome")}
                className="absolute left-4 flex min-h-10 items-center gap-1.5 rounded-full bg-black/25 px-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:bg-black/35"
                style={{ top: "max(1rem, env(safe-area-inset-top))" }}
              >
                <ArrowLeft size={16} /> {t("auth.back")}
              </button>
            )}
          </div>

          <div className="relative -mt-12 flex flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="flex animate-fade-in flex-col items-center text-center motion-reduce:animate-none">
              <GolfMeIcon size={64} variant="gradient" className="rounded-[1.1rem] shadow-lg shadow-brand-forest/25 ring-4 ring-[#faf9f6]" />
              <GolfMeWordmark className="mt-3 text-[1.7rem] font-extrabold leading-none tracking-tight" />
              <h1 className="mt-4 text-[1.6rem] font-extrabold leading-tight tracking-tight text-brand-forest">{t("auth.welcome.headline")}</h1>
              <p className="mt-1.5 max-w-[18rem] text-[15px] leading-snug text-slate-600">{t("auth.welcome.subheadline")}</p>
            </div>

            <div className="mt-auto flex flex-col gap-3 pt-6">
              {sessionExpired && (
                <p role="status" className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left text-sm text-slate-600">
                  <Info size={16} className="mt-0.5 shrink-0 text-fairway-700" aria-hidden />
                  {t("auth.sessionExpired")}
                </p>
              )}
              {/* Apple HIG: black button with Apple's logo and title, at least as prominent as the other buttons, so it goes first. */}
              {showApple && (
                <button type="button" onClick={continueWithApple} disabled={busy} className={`${methodButton} bg-black text-white hover:bg-neutral-800`}>
                  <AppleIcon size={18} /> {t("auth.continueWithApple")}
                </button>
              )}
              {showGoogle && (
                <button
                  type="button"
                  onClick={continueWithGoogle}
                  disabled={busy}
                  className={`${methodButton} border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:shadow-sm`}
                >
                  <GoogleIcon size={17} /> {t("auth.continueWithGoogle")}
                </button>
              )}
              <button
                type="button"
                onClick={chooseEmail}
                disabled={busy}
                className={`${methodButton} border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:shadow-sm`}
              >
                <Mail size={17} className="text-brand-forest" /> {t("auth.continueWithEmail")}
              </button>
              {extraEntries}
              <div className="pt-1">{legal}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Email and code steps: top-aligned (so the keyboard never covers the
  // field), small brand header with Back.
  // Back from the email box keeps what was typed (the draft), unlike "Use a
  // different method", which clears it.
  const backToWelcome = () => {
    setShowEmailField(false);
    setLinkFailed(false);
  };
  const onBack = step === "code" ? changeEmail : hasSocial ? backToWelcome : null;
  let body: ReactNode;
  if (step === "email") {
    const showEmailError = emailTouched && email && !emailValid;
    body = (
      <>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-brand-forest">{t("auth.email.title")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{t("auth.email.body", { count: EMAIL_OTP_LENGTH })}</p>
        {linkFailed && (
          <div role="alert" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left">
            <p className="text-sm font-semibold text-amber-900">{t("auth.code.linkExpiredTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">{t("auth.code.linkExpiredBody", { count: EMAIL_OTP_LENGTH })}</p>
            <button
              type="button"
              onClick={sendNewCodeFromNotice}
              disabled={sending}
              aria-busy={sending || undefined}
              className="mt-2 min-h-11 text-xs font-semibold text-amber-900 underline disabled:text-amber-600/70 disabled:no-underline"
            >
              {t("auth.code.resend")}
            </button>
          </div>
        )}
        {/* A real form: Enter / the keyboard's Go key sends, and iOS offers the saved address above the keyboard. */}
        <form onSubmit={continueWithEmail} noValidate className="mt-6 flex flex-col gap-2">
          <label htmlFor="auth-email" className="text-sm font-semibold text-slate-700">
            {t("auth.emailLabel")}
          </label>
          <div className="relative">
            <Mail size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              ref={(el) => {
                emailInputRef.current = el;
                if (el && focusEmailOnMount.current) {
                  focusEmailOnMount.current = false;
                  el.focus();
                }
              }}
              // Locked while sending: the code screen is bound to the
              // address that was submitted.
              disabled={sending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder="you@example.com"
              aria-invalid={showEmailError ? true : undefined}
              aria-describedby={showEmailError ? "auth-email-error" : undefined}
              className={`${inputClass} min-h-[52px] rounded-2xl pl-11 text-base disabled:bg-slate-50 disabled:text-slate-500`}
            />
          </div>
          {showEmailError && (
            <p id="auth-email-error" role="alert" className="text-xs leading-relaxed text-red-600">
              {t("auth.invalidEmail")}
            </p>
          )}
          <Button type="submit" disabled={!emailValid || busy || sending} aria-busy={sending || undefined} fullWidth className="mt-3 min-h-[52px] gap-2 text-[15px]">
            {sending && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {t("auth.email.send")}
          </Button>
        </form>
        {!hasSocial && <div className="mt-6">{extraEntries}</div>}
      </>
    );
  } else {
    const [before, after] = t("auth.code.sentTo", { count: EMAIL_OTP_LENGTH, email: "\u0000" }).split("\u0000");
    body = (
      <>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-brand-forest">{t("auth.checkEmailTitle")}</h1>
        <p className="mt-2 break-words text-[15px] leading-relaxed text-slate-600">
          {before}
          <strong className="font-semibold text-slate-900">{sentTo}</strong>
          {after}
        </p>
        {linkFailed && (
          // A restored code screen: the failed link may be from this email
          // or an older one, so both ways forward are offered.
          <div role="alert" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left">
            <p className="text-sm font-semibold text-amber-900">{t("auth.code.linkExpiredTitle")}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-amber-800">{t("auth.code.linkExpiredCodeBody", { email: sentTo ?? "" })}</p>
            <button
              type="button"
              onClick={resendCode}
              disabled={sending || verifying || resendLeft > 0}
              aria-busy={sending || undefined}
              className="mt-2 min-h-11 text-xs font-semibold text-amber-900 underline disabled:text-amber-600/70 disabled:no-underline"
            >
              {resendLeft > 0 ? t("auth.code.resendIn", { seconds: resendLeft }) : t("auth.code.resend")}
            </button>
          </div>
        )}
        <form onSubmit={verifyCode} className="mt-6 flex flex-col gap-3">
          <CodeInput
            id="email-otp"
            value={code}
            length={EMAIL_OTP_LENGTH}
            onChange={onCodeChange}
            label={t("auth.code.label", { count: EMAIL_OTP_LENGTH })}
            disabled={verifying}
            invalid={Boolean(codeError)}
            describedBy={codeError ? "email-otp-error" : undefined}
            autoFocus
          />
          <div className="min-h-5" aria-live="polite">
            {codeError ? (
              <p id="email-otp-error" role="alert" className="text-sm leading-relaxed text-red-600">
                {codeError}
              </p>
            ) : verifying ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> {t("auth.code.verifying")}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={code.length < EMAIL_OTP_LENGTH || verifying} aria-busy={verifying || undefined} fullWidth className="min-h-[52px] gap-2 text-[15px]">
            {t("auth.code.verify")}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-1 text-sm text-slate-500">
          <span>{t("auth.code.didntGet")}</span>
          <button
            type="button"
            onClick={resendCode}
            disabled={sending || verifying || resendLeft > 0}
            aria-busy={sending || undefined}
            className="min-h-11 px-1 font-semibold text-fairway-700 hover:underline disabled:text-slate-400 disabled:no-underline"
          >
            {resendLeft > 0 ? t("auth.code.resendCodeIn", { seconds: resendLeft }) : t("auth.code.resendCode")}
          </button>
        </div>
        <div className="flex flex-col items-center">
          <button type="button" onClick={changeEmail} className="min-h-11 px-3 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:underline">
            {t("auth.code.changeEmail")}
          </button>
          <button type="button" onClick={useDifferentMethod} className="-mt-1 min-h-11 px-3 text-xs font-semibold text-slate-400 hover:text-slate-600 hover:underline">
            {t("auth.useDifferentMethod")}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-[100svh] flex-col bg-[#faf9f6]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="relative flex h-12 items-center justify-center">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("auth.back")}
              className="absolute -left-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <GolfMeIcon size={30} variant="gradient" className="rounded-lg" />
            <GolfMeWordmark className="text-lg font-extrabold tracking-tight" />
          </div>
        </div>
        <div key={step} className="mt-8 flex flex-1 animate-fade-in flex-col motion-reduce:animate-none">
          {body}
          <div className="mt-auto pt-8">{legal}</div>
        </div>
      </div>
    </div>
  );
}
