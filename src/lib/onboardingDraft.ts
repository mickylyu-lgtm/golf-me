import type { GolfVibe, WalkOrCart } from "../types";
import type { GeoPoint } from "./geo";

export type SkillBand = "Beginner" | "Intermediate" | "Advanced";
export type RoundLengthChoice = "9" | "18" | "either";

// Draft-only resume (no account exists until the final ProfileSetup step) —
// answers are written here as the user fills the wizard so closing the tab
// mid-setup and coming back restores both the form and the step they were
// on, without any backend/session complexity. Cleared once signUpNewGolfer
// actually runs, or via Settings' dev-only "Reset Onboarding."
export interface OnboardingDraft {
  step: number;
  name: string;
  is18Plus: boolean;
  gender: string;
  customGender: boolean;
  areaLabel: string;
  playingAreaCoords?: GeoPoint;
  favoriteCourse: string;
  hasHandicap: boolean;
  handicap: number | "";
  skillBand: SkillBand;
  vibes: GolfVibe[];
  walkOrCart: WalkOrCart;
  budget: number | "";
  travelRadiusMiles: number;
  roundLength: RoundLengthChoice;
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
