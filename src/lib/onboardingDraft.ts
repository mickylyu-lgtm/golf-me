import type { GeoPoint } from "./geo";

// Draft-only resume (no account exists until the final ProfileSetup step) —
// answers are written here as the user fills the single Quick Profile
// screen so closing the tab mid-setup and coming back restores the form,
// without any backend/session complexity. Cleared once signUpNewGolfer/
// saveProfile actually runs, or via Settings' dev-only "Reset Onboarding."
//
// Deliberately small: gender, favorite course, round length, vibes,
// walk/cart, budget, and travel radius are no longer collected during
// onboarding (moved to progressive setup in Profile/Match Preferences), so
// there's nothing to resume for them here.
export interface OnboardingDraft {
  name: string;
  is18Plus: boolean;
  areaLabel: string;
  playingAreaCoords?: GeoPoint;
  hasHandicap: boolean;
  handicap: number | "";
}

const DRAFT_KEY = "golfme:onboardingDraft";

export function loadOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as OnboardingDraft) : null;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}

export function hasOnboardingDraft(): boolean {
  return loadOnboardingDraft() !== null;
}
