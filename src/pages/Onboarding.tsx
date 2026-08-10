import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, ShieldCheck, Users } from "lucide-react";
import { Button } from "../components/ui/Button";
import { GolfChatMark } from "../components/brand/GolfChatMark";
import { GolfMeWordmark } from "../components/brand/GolfMeWordmark";

const SCREENS = [
  {
    icon: Compass,
    title: "Play more golf.",
    body: "Find nearby rounds that need another player — no more waiting on your usual group's schedule.",
  },
  {
    icon: Users,
    title: "Find your kind of group.",
    body: "Match around schedule, distance, skill, budget, and golf vibe — so every round actually fits you.",
  },
  {
    icon: ShieldCheck,
    title: "Build your golf circle.",
    body: "Play together, build credibility, and find golfers you would actually play with again.",
    credibilityNote: true,
  },
] as const;

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const screen = SCREENS[step];
  const isLast = step === SCREENS.length - 1;
  const Icon = screen.icon;

  function next() {
    if (isLast) navigate("/signup");
    else setStep((s) => s + 1);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f2] px-6 py-8">
      <div className="mb-5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-fairway-600 text-white">
          <GolfChatMark size={15} />
        </span>
        <GolfMeWordmark className="text-sm font-extrabold tracking-tight" golfClassName="text-fairway-900" />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {SCREENS.map((_, i) => (
            <span key={i} className={`h-1.5 w-8 rounded-full transition-colors duration-300 ${i === step ? "bg-fairway-600" : "bg-slate-200"}`} />
          ))}
        </div>
        <button
          onClick={() => navigate("/signup")}
          className="text-sm font-semibold text-slate-400 transition-colors duration-200 hover:text-slate-600"
        >
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-fairway-50 text-fairway-600">
          <Icon size={30} />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">{screen.title}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">{screen.body}</p>
        </div>

        {"credibilityNote" in screen && screen.credibilityNote && (
          <div className="mx-auto max-w-xs rounded-2xl border border-slate-100 bg-white p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">GolfMe is built around good golf partners</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              After rounds, golfers can give private feedback about reliability, pace, sportsmanship, and handicap
              accuracy. Credibility improves naturally as you complete good rounds.
            </p>
          </div>
        )}
      </div>

      <Button size="lg" fullWidth onClick={next}>
        {isLast ? "Create My Profile" : "Next"}
      </Button>
    </div>
  );
}
