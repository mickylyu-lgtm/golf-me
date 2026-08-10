import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { GolfMeIcon } from "../components/brand/GolfMeIcon";
import { GolfMeWordmark } from "../components/brand/GolfMeWordmark";

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-gradient-to-br from-fairway-700 via-fairway-800 to-fairway-950 px-6 py-12 text-center text-white">
      <div className="pointer-events-none fixed -right-16 -top-16 h-72 w-72 rounded-full bg-white/5" />
      <div className="pointer-events-none fixed -bottom-24 -left-16 h-80 w-80 rounded-full bg-sun-400/10" />

      <div />

      <div className="relative flex flex-col items-center gap-5">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
          <GolfMeIcon size={34} dotColor="#f8faf8" targetColor="#8bc09a" holeColor="#19422a" />
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight">
          <GolfMeWordmark golfClassName="text-white" meClassName="text-sun-300" />
        </h1>
        <div>
          <p className="text-xl font-bold">Find your next round.</p>
          <p className="mt-2 max-w-xs text-sm text-fairway-100">
            Golf when you want, even when your usual group can't.
          </p>
        </div>
      </div>

      <div className="relative flex w-full max-w-xs flex-col gap-3">
        <Button size="lg" variant="secondary" fullWidth onClick={() => navigate("/onboarding")}>
          Get Started
        </Button>
        <button
          onClick={() => navigate("/login")}
          className="rounded-full px-4 py-2.5 text-sm font-semibold text-white/80 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fairway-800"
        >
          Log In
        </button>
      </div>
    </div>
  );
}
