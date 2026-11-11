import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { canReplayTutorial } from "../lib/tutorialAccess";
import { TUTORIAL_LAST_INDEX, TUTORIAL_STEPS } from "../lib/tutorialSteps";

interface TutorialContextValue {
  active: boolean;
  stepIndex: number;
  start: () => void;
  replay: () => void;
  canReplay: boolean;
  next: () => void;
  back: () => void;
  skip: () => void;
  // The walkthrough ended (finished or skipped) during this app session --
  // lets the first-round hosting popup follow it right away even if saving
  // onboarding_tutorial_completed failed. Never persisted.
  completedThisSession: boolean;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isDemo, authUser, onboardingTutorialCompleted, saveProfile } = useAuth();
  const selfId = !isDemo ? authUser?.id : undefined;
  const canReplay = canReplayTutorial(isDemo, authUser?.id);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const active = !!selfId && activeUserId === selfId;
  const [stepIndex, setStepIndex] = useState(0);
  const [completedUserId, setCompletedUserId] = useState<string | null>(null);
  const completedThisSession = !!selfId && completedUserId === selfId;
  // Completion can race a lazy Home mount's already-queued auto-start effect.
  // Mark it synchronously, not only after React commits the state update.
  const completedUserRef = useRef<string | null>(null);
  const accountUserRef = useRef(selfId);

  useLayoutEffect(() => {
    // Do not reset on mount (including StrictMode effect replay): Home may
    // already have queued its one-time automatic start.
    if (accountUserRef.current === selfId) return;
    accountUserRef.current = selfId;
    completedUserRef.current = null;
    setActiveUserId(null);
    setCompletedUserId(null);
    setStepIndex(0);
  }, [selfId]);

  // Completion belongs to the signed-in account, never a demo profile.
  const persistCompleted = useCallback(async () => {
    if (!selfId) return;
    try {
      await saveProfile({ onboarding_tutorial_completed: true });
    } catch (err) {
      console.error("GolfMe: failed to persist tutorial completion.", err);
    }
  }, [selfId, saveProfile]);

  const begin = useCallback(() => {
    if (!selfId || accountUserRef.current !== selfId) return;
    setStepIndex(0);
    setActiveUserId(selfId);
    navigate(TUTORIAL_STEPS[0].route);
  }, [selfId, navigate]);

  // Home's one-time onboarding stays available to every new real account.
  // Manual replay is a separate founder-only action, guarded here as well
  // as in Settings. Profile names, emails, demo IDs and admin roles do not
  // confer access.
  const start = useCallback(() => {
    if (onboardingTutorialCompleted || completedThisSession || completedUserRef.current === selfId) return;
    begin();
  }, [begin, selfId, onboardingTutorialCompleted, completedThisSession]);
  const replay = useCallback(() => {
    if (!canReplay) return;
    begin();
  }, [canReplay, begin]);

  // Not functional setState updates -- navigate() is itself a setState
  // (React Router's own), and calling one setState from inside another's
  // updater function is exactly what React's "Cannot update a component
  // while rendering a different component" warning flags. These only ever
  // fire from a discrete click (never rapid/concurrent calls where a stale
  // `stepIndex` closure would matter), so reading it directly is safe.
  const next = useCallback(() => {
    if (!active || accountUserRef.current !== selfId) return;
    if (stepIndex >= TUTORIAL_LAST_INDEX) {
      completedUserRef.current = selfId ?? null;
      setActiveUserId(null);
      setCompletedUserId(selfId ?? null);
      void persistCompleted();
      navigate("/");
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    navigate(TUTORIAL_STEPS[nextIndex].route);
  }, [active, selfId, stepIndex, navigate, persistCompleted]);

  const back = useCallback(() => {
    if (!active || accountUserRef.current !== selfId) return;
    if (stepIndex <= 0) return;
    const prevIndex = stepIndex - 1;
    setStepIndex(prevIndex);
    navigate(TUTORIAL_STEPS[prevIndex].route);
  }, [active, selfId, stepIndex, navigate]);

  const skip = useCallback(() => {
    if (!active || accountUserRef.current !== selfId) return;
    completedUserRef.current = selfId ?? null;
    setActiveUserId(null);
    setCompletedUserId(selfId ?? null);
    void persistCompleted();
  }, [active, selfId, persistCompleted]);

  const value = useMemo(
    () => ({ active, stepIndex, start, replay, canReplay, next, back, skip, completedThisSession }),
    [active, stepIndex, start, replay, canReplay, next, back, skip, completedThisSession],
  );

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
