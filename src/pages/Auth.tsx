import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Mail } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { inputClass } from "../components/ui/FormControls";
import { DEFAULT_CURRENT_USER_ID, DEMO_LOGIN_GOLFER_IDS } from "../data/golfers";
import { isNewAccount } from "../lib/format";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";

interface AuthProps {
  mode: "login" | "signup";
}

export function Auth({ mode }: AuthProps) {
  const navigate = useNavigate();
  const { logIn, session, golfers } = useData();
  const { showToast } = useToast();
  const [showEmailField, setShowEmailField] = useState(false);
  const [email, setEmail] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const loginableAccounts = DEMO_LOGIN_GOLFER_IDS.map((id) => golfers.find((g) => g.id === id)).filter(
    (g): g is NonNullable<typeof g> => Boolean(g),
  );

  function continueWith() {
    if (mode === "signup") {
      navigate("/profile-setup");
      return;
    }
    // Login: there's no real backend to distinguish Apple/Google/Email, so
    // every path here surfaces the same "choose your account" picker rather
    // than silently authenticating as whichever golfer happened to be
    // sitting in storage. Only "Try Demo Account" below skips the picker.
    setShowPicker(true);
  }

  function loginAs(golferId: string, label: string) {
    logIn(golferId);
    showToast(`Signed in as ${label}.`, "success");
    navigate("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f2] px-6 py-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 self-start text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-fairway-600">
            <GolfMeIcon size={26} dotColor="#f8faf8" targetColor="#5aa171" holeColor="#143621" />
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900">
            {mode === "signup" ? "Create your account" : session.hasOnboarded ? "Welcome back" : "Log in"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === "signup" ? "Let's get your golfer profile set up." : "Pick up right where you left off."}
          </p>
        </div>

        {mode === "login" && showPicker ? (
          <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Prototype — choose your account
              </p>
              <div className="flex flex-col gap-1">
                {loginableAccounts.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => loginAs(g.id, g.name)}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-200 hover:bg-slate-50"
                  >
                    <Avatar golfer={g} size="sm" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                      <p className="text-xs text-slate-500">
                        {isNewAccount(g.reputation.completedRounds) ? "New account" : `${g.reputation.completedRounds} rounds played`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setShowPicker(false)}
              className="rounded-full px-4 py-2 text-xs font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
            >
              Back
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
            <button
              onClick={() => continueWith()}
              className="flex items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:-translate-y-px hover:bg-slate-800 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              Continue with Apple
            </button>
            <button
              onClick={() => continueWith()}
              className="flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              Continue with Google
            </button>

            {!showEmailField ? (
              <button
                onClick={() => setShowEmailField(true)}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-300 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                <Mail size={16} /> Continue with Email
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
                <Button onClick={() => continueWith()} disabled={!email.includes("@")} fullWidth>
                  Continue
                </Button>
              </div>
            )}

            {mode === "login" && (
              <>
                <div className="my-1 flex items-center gap-3 text-xs font-medium text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" />
                  or
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
                <button
                  onClick={() => loginAs(DEFAULT_CURRENT_USER_ID, "Jordan (Demo Account)")}
                  className="flex items-center justify-center gap-2 rounded-full border border-dashed border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-px hover:border-slate-400 hover:bg-slate-50 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  <Check size={16} /> Try Demo Account
                </button>
              </>
            )}
          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button onClick={() => navigate("/login")} className="font-semibold text-fairway-700 hover:underline">
                Log In
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button onClick={() => navigate("/onboarding")} className="font-semibold text-fairway-700 hover:underline">
                Get Started
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
