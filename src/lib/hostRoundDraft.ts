import type { GameFormat, GolfVibe, Holes, JoinMode, SkillFilter, WalkOrCart } from "../types";

export type WhenChoice = "today" | "tomorrow" | "weekend" | "date";
export type LookingFor = "anyone" | "similar" | "custom";

// Host Round is a 5-step wizard with no persistence at all -- reported live
// as typed fields (course, notes, price, etc.) vanishing after attaching a
// booking-proof photo (native photo picker) or backing out to check
// something else, same class of bug as a chat message vanishing if you
// left mid-type. Persisted the same way onboardingDraft.ts resumes
// ProfileSetup: one slot, restored on mount, cleared only once the round is
// actually posted -- backing all the way out keeps the draft, matching a
// chat composer's own "didn't send, still there" behavior. proofFile (a
// File, not serializable) is deliberately excluded -- same tradeoff as
// ProfileSetup's photoUrl -- a host who abandons and returns just re-picks it.
export interface HostRoundDraft {
  step: number;
  fillMode: boolean;
  course: string;
  pickedCourseId: string | null;
  pickedCourseLat: number | null;
  pickedCourseLng: number | null;
  areaLabel: string;
  distanceMiles: number | "";
  when: WhenChoice;
  date: string;
  timeLabel: string;
  price: number | "";
  totalSpots: number;
  joinMode: JoinMode;
  lookingFor: LookingFor;
  skillLevel: SkillFilter;
  vibe: GolfVibe;
  walkOrCart: WalkOrCart;
  holes: Holes;
  gameFormat: GameFormat;
  notes: string;
  friendIds: string[];
  proofExpanded: boolean;
  proofSource: string;
  proofReference: string;
}

const DRAFT_KEY = "golfme:hostRoundDraft";

export function loadHostRoundDraft(): HostRoundDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as HostRoundDraft) : null;
  } catch {
    return null;
  }
}

export function saveHostRoundDraft(draft: HostRoundDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearHostRoundDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}
