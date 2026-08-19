import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldCheck, XCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { PENDING_REVIEWER_INVITE_KEY } from "../lib/usePendingReviewerInviteRedemption";
import { Button } from "../components/ui/Button";

type ViewState = "checking" | "needs-auth" | "demo" | "success" | "error";

// Standalone landing page for a Coach Reviewer invite link
// (/coach-invite/:token) — see App.tsx for why this sits outside both
// GuestOnly and AuthedLayout. Handles all three real states itself:
// already signed in (redeems immediately, right here), not signed in yet
// (stores the token and sends them to log in or sign up — actual
// redemption then happens via usePendingReviewerInviteRedemption once a
// session exists, since onboarding lands on /ready, not back on this URL),
// or demo mode (a real Supabase auth session is required, same as every
// other real-only feature in the app).
export function CoachInvite() {
  const { token } = useParams<{ token: string }>();
  const { isDemo, authUser } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<ViewState>("checking");
  const [errorMessage, setErrorMessage] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (isDemo) {
      setState("demo");
      return;
    }
    if (!authUser) {
      window.sessionStorage.setItem(PENDING_REVIEWER_INVITE_KEY, token);
      setState("needs-auth");
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    supabase.rpc("redeem_reviewer_invite", { p_token: token }).then(({ error }) => {
      if (error) {
        setErrorMessage(error.message);
        setState("error");
      } else {
        setState("success");
      }
    });
  }, [token, isDemo, authUser]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#faf9f6] px-6 py-12 text-center">
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
          state === "error" ? "bg-red-50 text-red-500" : "bg-fairway-50 text-fairway-600"
        }`}
      >
        {state === "error" ? <XCircle size={26} /> : <ShieldCheck size={26} />}
      </span>

      {state === "checking" && (
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Checking your invite…</h1>
        </div>
      )}

      {state === "demo" && (
        <>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">You're in demo mode</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">Log in with a real GolfMe account to accept this Coach Reviewer invite.</p>
          </div>
          <Button size="lg" onClick={() => navigate("/")}>
            Back to GolfMe
          </Button>
        </>
      )}

      {state === "needs-auth" && (
        <>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">You've been invited to GolfMe</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">Log in or create an account to become a Coach Reviewer.</p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <Button size="lg" fullWidth onClick={() => navigate("/login")}>
              Log In
            </Button>
            <Button size="lg" variant="outline" fullWidth onClick={() => navigate("/welcome")}>
              Create Account
            </Button>
          </div>
        </>
      )}

      {state === "success" && (
        <>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">You're now a Coach Reviewer</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
              Look for "Leave Coach Review" on swing posts in Community.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate("/")}>
            Continue to GolfMe
          </Button>
        </>
      )}

      {state === "error" && (
        <>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">This invite didn't work</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">{errorMessage}</p>
          </div>
          <Button size="lg" onClick={() => navigate("/")}>
            Continue to GolfMe
          </Button>
        </>
      )}
    </div>
  );
}
