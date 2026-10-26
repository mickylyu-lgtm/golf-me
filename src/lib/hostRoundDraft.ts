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
// A draft untouched this long is a round nobody is still planning.
const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Stored with the account it belongs to (2026-10-26: a draft started on one
// account, e.g. at Liberty National in NYC, refilled Host a Round on another
// account on the same phone). `owner` is the auth user id, or "demo".
interface StoredDraft extends HostRoundDraft {
  owner?: string;
  savedAt?: number;
}

export function loadHostRoundDraft(owner: string): HostRoundDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const { owner: draftOwner, savedAt, ...draft } = JSON.parse(raw) as StoredDraft;
    // Drafts saved before owners were recorded can't be told apart: drop them.
    if (draftOwner !== owner || !savedAt || Date.now() - savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveHostRoundDraft(owner: string, draft: HostRoundDraft): void {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredDraft = { ...draft, owner, savedAt: Date.now() };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  } catch {
    // Full or blocked storage: the draft just isn't kept.
  }
}

export function clearHostRoundDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}
