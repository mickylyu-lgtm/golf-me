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
  handicap: number | "";
}

const DRAFT_KEY = "golfme:onboardingDraft";
const HANDICAP_ENTRY_VERSION = 1;

export function optionalHandicap(input: OnboardingDraft["handicap"]): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

export function loadOnboardingDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as (OnboardingDraft & { handicapEntryVersion?: number; hasHandicap?: boolean }) | null;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const { handicapEntryVersion, hasHandicap, ...draft } = stored;
    // The old wizard initialized every new draft at 15, without marking edits.
    // Only an unfinished, unversioned 15 is ambiguous; keep other entered
    // values and all unrelated answers. This never reads or edits a profile row.
    if (handicapEntryVersion !== HANDICAP_ENTRY_VERSION && (hasHandicap === false || draft.handicap === 15)) {
      return { ...draft, handicap: "" };
    }
    return { ...draft, handicap: optionalHandicap(draft.handicap) ?? "" };
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, handicapEntryVersion: HANDICAP_ENTRY_VERSION }));
  } catch {
    // Draft persistence is optional: full or blocked storage must not crash
    // Quick Profile's effect and prevent the golfer from finishing setup.
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}

export function hasOnboardingDraft(): boolean {
  return loadOnboardingDraft() !== null;
}
