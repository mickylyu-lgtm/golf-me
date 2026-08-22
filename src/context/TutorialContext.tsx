import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { TUTORIAL_LAST_INDEX, TUTORIAL_STEPS } from "../lib/tutorialSteps";

interface TutorialContextValue {
  active: boolean;
  stepIndex: number;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isDemo, saveProfile } = useAuth();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Demo accounts have no real profiles row to persist the flag on -- the
  // walkthrough itself still works if launched manually (Settings ->
  // Replay Tutorial), it just never auto-starts and never fails trying to
  // save a completion state that has nowhere real to live.
  const persistCompleted = useCallback(async () => {
    if (isDemo) return;
    try {
      await saveProfile({ onboarding_tutorial_completed: true });
    } catch (err) {
      console.error("Golf Me: failed to persist tutorial completion.", err);
    }
  }, [isDemo, saveProfile]);

  const start = useCallback(() => {
    setStepIndex(0);
    setActive(true);
    navigate(TUTORIAL_STEPS[0].route);
  }, [navigate]);

  // Not functional setState updates -- navigate() is itself a setState
  // (React Router's own), and calling one setState from inside another's
  // updater function is exactly what React's "Cannot update a component
  // while rendering a different component" warning flags. These only ever
  // fire from a discrete click (never rapid/concurrent calls where a stale
  // `stepIndex` closure would matter), so reading it directly is safe.
  const next = useCallback(() => {
    if (stepIndex >= TUTORIAL_LAST_INDEX) {
      setActive(false);
      void persistCompleted();
      navigate("/");
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    navigate(TUTORIAL_STEPS[nextIndex].route);
  }, [stepIndex, navigate, persistCompleted]);

  const back = useCallback(() => {
    if (stepIndex <= 0) return;
    const prevIndex = stepIndex - 1;
    setStepIndex(prevIndex);
    navigate(TUTORIAL_STEPS[prevIndex].route);
  }, [stepIndex, navigate]);

  const skip = useCallback(() => {
    setActive(false);
    void persistCompleted();
  }, [persistCompleted]);

  const value = useMemo(() => ({ active, stepIndex, start, next, back, skip }), [active, stepIndex, start, next, back, skip]);

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used within a TutorialProvider");
  return ctx;
}

// Exposed alongside the context (not through it) since it's read once on
// mount, outside any user interaction -- Home's own auto-start effect is
// the only caller.
export function useTutorialEligibility(): { eligible: boolean } {
  const { isDemo, onboardingTutorialCompleted } = useAuth();
  return { eligible: !isDemo && !onboardingTutorialCompleted };
}
