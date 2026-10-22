// First Round Hosting Onboarding: the pure show/no-show rules, kept free of
// React, Supabase and i18n so they can be unit-tested with node --test
// (tests/firstRoundPrompt.test.ts). FirstRoundPromptContext gathers the
// inputs; nothing else decides whether the popup or the Home card shows.
//
// Rules (product decisions, Micky 2026-10-22):
//   * never for demo accounts;
//   * only real, onboarded accounts that have never hosted a round, and only
//     once "has hosted" is actually known (null = still loading or failed:
//     never guess "no" and nag someone who has hosted);
//   * only after the first-run tutorial is over, never while it runs;
//   * once closed (Maybe Later, X, or acting on it) never again, on any
//     device (profiles.first_round_prompt_dismissed_at, plus a local copy);
//   * only while idle on Home with no other modal/onboarding overlay open;
//   * only at a session start: the first Home landing after the app opened,
//     or right after the tutorial finished in this session. Never in the
//     middle of an active session.

export interface FirstRoundPromptInputs {
  isDemo: boolean;
  signedIn: boolean;
  hasOnboarded: boolean;
  /** profiles.onboarding_tutorial_completed */
  tutorialCompleted: boolean;
  tutorialActive: boolean;
  /** The tutorial ended during this app session (covers a failed save of the flag too). */
  tutorialJustCompleted: boolean;
  /** true / false once known; null while loading or after an error. */
  hasHosted: boolean | null;
  dismissed: boolean;
  onHome: boolean;
  /** Any modal, sheet, the push pre-permission prompt or the launch overlay is open or about to open. */
  blockingOverlayOpen: boolean;
  /** Still inside the session-start window (see FirstRoundPromptContext). */
  sessionStartWindowOpen: boolean;
  alreadyShownThisSession: boolean;
}

export type FirstRoundPromptReason =
  | "show"
  | "demo"
  | "signed_out"
  | "not_onboarded"
  | "tutorial_pending"
  | "hosted_unknown"
  | "already_hosted"
  | "dismissed"
  | "already_shown"
  | "not_on_home"
  | "overlay_open"
  | "mid_session";

export interface FirstRoundPromptDecision {
  show: boolean;
  reason: FirstRoundPromptReason;
}

export function decideFirstRoundPrompt(i: FirstRoundPromptInputs): FirstRoundPromptDecision {
  const no = (reason: FirstRoundPromptReason): FirstRoundPromptDecision => ({ show: false, reason });
  if (i.isDemo) return no("demo");
  if (!i.signedIn) return no("signed_out");
  if (!i.hasOnboarded) return no("not_onboarded");
  if (i.tutorialActive || !(i.tutorialCompleted || i.tutorialJustCompleted)) return no("tutorial_pending");
  if (i.hasHosted === null) return no("hosted_unknown");
  if (i.hasHosted) return no("already_hosted");
  if (i.dismissed) return no("dismissed");
  if (i.alreadyShownThisSession) return no("already_shown");
  if (!i.onHome) return no("not_on_home");
  if (i.blockingOverlayOpen) return no("overlay_open");
  if (!i.sessionStartWindowOpen && !i.tutorialJustCompleted) return no("mid_session");
  return { show: true, reason: "show" };
}

export interface HostReminderCardInputs {
  isDemo: boolean;
  signedIn: boolean;
  hasHosted: boolean | null;
  dismissed: boolean;
}

// The small Home card that replaces the popup once it was closed. Stays until
// the first round is created successfully (hasHosted flips true only after
// host_golf_call returned and the round list refetched), so starting the
// wizard and backing out leaves it in place.
export function shouldShowHostReminderCard(i: HostReminderCardInputs): boolean {
  return !i.isDemo && i.signedIn && i.dismissed && i.hasHosted === false;
}

// The session-start window closes the first time the golfer is anywhere but
// Home, or once they've spent this long idle on Home without the popup
// becoming eligible (e.g. the round count was slow to load). Overlay time
// doesn't count, so a push prompt on top of Home doesn't use it up.
export const SESSION_START_WINDOW_MS = 30_000;

// Conditions must hold this long before the popup appears, so an overlay
// whose own async check is still running (the push prompt) gets to claim the
// screen first instead of the two stacking.
export const PROMPT_SETTLE_MS = 1_200;
