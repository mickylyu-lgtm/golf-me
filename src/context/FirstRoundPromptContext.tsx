import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { useRealRounds } from "./RealRoundsContext";
import { useTutorial } from "./TutorialContext";
import { track } from "../lib/analytics";
import { isBlockingOverlayOpen, isUserTyping } from "../lib/blockingOverlays";
import {
  PROMPT_SETTLE_MS,
  SESSION_START_WINDOW_MS,
  decideFirstRoundPrompt,
  shouldShowHostReminderCard,
} from "../lib/firstRoundPrompt";
import { useShareActions } from "../lib/useShareActions";
import { FirstRoundPromptDialog } from "../components/onboarding/FirstRoundPromptDialog";

// First Round Hosting Onboarding: gathers the inputs for the pure rules in
// lib/firstRoundPrompt.ts, shows the popup at the right moment, and tells
// Home whether to show the reminder card. Mounted inside AuthedLayout (real
// and demo sessions both render it; the rules turn everything off for demo).

interface FirstRoundPromptValue {
  /** true / false once known; null while loading, on error, or for demo. */
  hasHosted: boolean | null;
  showReminderCard: boolean;
  /** Starts hosting from the popup or the reminder card (counts first_round_host_started). */
  startHosting: () => void;
}

const FirstRoundPromptContext = createContext<FirstRoundPromptValue | null>(null);

const LOCAL_DISMISS_PREFIX = "golfme:firstRoundPromptDismissed:";
const TICK_MS = 400;

function readLocalDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(LOCAL_DISMISS_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function writeLocalDismissed(userId: string): void {
  try {
    window.localStorage.setItem(LOCAL_DISMISS_PREFIX + userId, "1");
  } catch {
    // Best-effort: the profiles column is the cross-device record.
  }
}

// Per JS session (an app launch / page load), per account. Module level so
// it survives AuthedLayout remounts (sign-out -> sign-in starts a fresh
// window for the newly signed-in account).
const sessionState = {
  userId: null as string | null,
  windowOpen: true,
  idleOnHomeMs: 0,
  shown: false,
};

function sessionFor(userId: string) {
  if (sessionState.userId !== userId) {
    sessionState.userId = userId;
    sessionState.windowOpen = true;
    sessionState.idleOnHomeMs = 0;
    sessionState.shown = false;
  }
  return sessionState;
}

export function FirstRoundPromptProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser, hasOnboarded, onboardingTutorialCompleted, profileRow, saveProfile } = useAuth();
  const { golfCalls: realCalls } = useRealRounds();
  const { active: tutorialActive, completedThisSession } = useTutorial();
  const { shareApp } = useShareActions();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userId = !isDemo && authUser ? authUser.id : null;

  // ---- Has this account ever hosted? Own rounds from the live round list
  // (refetched right after host_golf_call succeeds) OR a direct count, so a
  // failed/slow list load never reads as "never hosted".
  const [serverHosted, setServerHosted] = useState<{ userId: string; value: boolean | null } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void Promise.resolve(
      supabase.from("golf_calls").select("id", { count: "exact", head: true }).eq("host_user_id", userId),
    ).then(
      ({ count, error }) => {
        if (!cancelled) setServerHosted({ userId, value: error ? null : (count ?? 0) > 0 });
      },
      () => {
        if (!cancelled) setServerHosted({ userId, value: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const listHasMine = useMemo(() => (userId ? realCalls.some((c) => c.hostId === userId) : false), [realCalls, userId]);
  const hasHosted: boolean | null = !userId
    ? null
    : listHasMine
      ? true
      : serverHosted?.userId === userId
        ? serverHosted.value
        : null;

  // ---- Dismissed? Server column (any device) or this device's copy (covers
  // the window before the migration is applied, or a failed save).
  const [localDismissedFor, setLocalDismissedFor] = useState<string | null>(null);
  const dismissed = Boolean(
    userId && (profileRow?.first_round_prompt_dismissed_at || localDismissedFor === userId || readLocalDismissed(userId)),
  );

  const [open, setOpen] = useState(false);

  const markDismissed = useCallback(() => {
    if (!userId) return;
    writeLocalDismissed(userId);
    setLocalDismissedFor(userId);
    saveProfile({ first_round_prompt_dismissed_at: new Date().toISOString() }).catch((err) =>
      console.warn("GolfMe: couldn't save first-round prompt dismissal (kept on this device).", err),
    );
  }, [userId, saveProfile]);

  // ---- Session-start window: closes the first time this account is seen
  // anywhere but Home in this app session.
  useEffect(() => {
    if (!userId) return;
    const s = sessionFor(userId);
    if (pathname !== "/") s.windowOpen = false;
  }, [userId, pathname]);

  // ---- Decide. Only ticks while the slow-changing conditions already allow
  // the popup; the DOM/typing checks are re-read on every tick.
  const candidate =
    Boolean(userId) &&
    !open &&
    decideFirstRoundPrompt({
      isDemo,
      signedIn: Boolean(authUser),
      hasOnboarded,
      tutorialCompleted: onboardingTutorialCompleted,
      tutorialActive,
      tutorialJustCompleted: completedThisSession,
      hasHosted,
      dismissed,
      onHome: pathname === "/",
      blockingOverlayOpen: false,
      sessionStartWindowOpen: true,
      alreadyShownThisSession: false,
    }).show;

  const stateRef = useRef({ completedThisSession, tutorialActive, hasHosted, dismissed, pathname });
  stateRef.current = { completedThisSession, tutorialActive, hasHosted, dismissed, pathname };

  useEffect(() => {
    if (!candidate || !userId) return;
    const s = sessionFor(userId);
    let stableMs = 0;
    const timer = window.setInterval(() => {
      const live = stateRef.current;
      const blocked =
        isBlockingOverlayOpen() || isUserTyping() || (typeof document !== "undefined" && document.visibilityState !== "visible");
      if (live.pathname === "/" && !blocked && s.windowOpen && !s.shown) {
        s.idleOnHomeMs += TICK_MS;
        if (s.idleOnHomeMs > SESSION_START_WINDOW_MS) s.windowOpen = false;
      }
      const decision = decideFirstRoundPrompt({
        isDemo: false,
        signedIn: true,
        hasOnboarded: true,
        tutorialCompleted: true,
        tutorialActive: live.tutorialActive,
        tutorialJustCompleted: live.completedThisSession,
        hasHosted: live.hasHosted,
        dismissed: live.dismissed,
        onHome: live.pathname === "/",
        blockingOverlayOpen: blocked,
        sessionStartWindowOpen: s.windowOpen,
        alreadyShownThisSession: s.shown,
      });
      stableMs = decision.show ? stableMs + TICK_MS : 0;
      if (stableMs >= PROMPT_SETTLE_MS) {
        s.shown = true;
        window.clearInterval(timer);
        setOpen(true);
        track("first_round_prompt_shown");
      }
      if (decision.reason === "mid_session" || decision.reason === "already_shown") window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // completedThisSession: a tutorial replay later in the session restarts the check.
  }, [candidate, userId, completedThisSession]);

  // Signed out / switched account / left Home while it was open: close it
  // without recording a dismissal they never made.
  useEffect(() => {
    if (open && (!userId || pathname !== "/")) setOpen(false);
  }, [open, userId, pathname]);

  const startHosting = useCallback(() => {
    track("first_round_host_started");
    navigate("/golf-calls/new");
  }, [navigate]);

  const handleHost = useCallback(() => {
    markDismissed();
    setOpen(false);
    startHosting();
  }, [markDismissed, startHosting]);

  const handleLater = useCallback(() => {
    markDismissed();
    setOpen(false);
  }, [markDismissed]);

  const showReminderCard = !open && shouldShowHostReminderCard({ isDemo, signedIn: Boolean(userId), hasHosted, dismissed });

  const value = useMemo(() => ({ hasHosted, showReminderCard, startHosting }), [hasHosted, showReminderCard, startHosting]);

  return (
    <FirstRoundPromptContext.Provider value={value}>
      {children}
      {open && <FirstRoundPromptDialog onHost={handleHost} onLater={handleLater} onInvite={() => void shareApp()} />}
    </FirstRoundPromptContext.Provider>
  );
}

export function useFirstRoundPrompt(): FirstRoundPromptValue {
  const ctx = useContext(FirstRoundPromptContext);
  if (!ctx) throw new Error("useFirstRoundPrompt must be used within a FirstRoundPromptProvider");
  return ctx;
}
