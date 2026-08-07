import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { inputClass } from "../components/ui/FormControls";

interface AuthProps {
  mode: "login" | "signup";
}

export function Auth({ mode }: AuthProps) {
  const navigate = useNavigate();
  const { logIn, session } = useData();
  const { showToast } = useToast();
  const [showEmailField, setShowEmailField] = useState(false);
  const [email, setEmail] = useState("");

  function continueWith(method: string) {
    if (mode === "signup") {
      navigate("/profile-setup");
      return;
    }
    // Login: this browser already has a mock account (or is starting fresh
    // as the default seeded golfer) — authenticate and skip onboarding.
    logIn();
    showToast(`Signed in with ${method}.`, "success");
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
          <h1 className="text-2xl font-extrabold text-slate-900">
            {mode === "signup" ? "Create your account" : session.hasOnboarded ? "Welcome back" : "Log in"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === "signup" ? "Let's get your golfer profile set up." : "Pick up right where you left off."}
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
          <button
            onClick={() => continueWith("Apple")}
            className="flex items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:-translate-y-px hover:bg-slate-800 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            Continue with Apple
          </button>
          <button
            onClick={() => continueWith("Google")}
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
              <Button onClick={() => continueWith("Email")} disabled={!email.includes("@")} fullWidth>
                Continue
              </Button>
            </div>
          )}
        </div>

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
