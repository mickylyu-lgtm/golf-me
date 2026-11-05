// What a new golfer said they're here for on the Ready screen ("what are you
// looking for?"), and the first-week personalization it drives. No React;
// the rules are pure and run under node --test
// (tests/onboardingIntent.test.ts), and only the two small read/save
// wrappers at the bottom touch localStorage. Ready saves it, Home and
// FirstRoundPromptContext read it.
//
// Kept on this device only (localStorage), never sent to the server. Scoped
// to the account that answered, and only honoured for INTENT_FOCUS_DAYS
// after answering: the point is a first session that starts where the
// golfer said they wanted to go, not a permanent layout. Accounts that never
// saw Ready (everyone onboarded before this) have nothing stored, and the
// older bare-array format Ready used to write is ignored, so their Home and
// first-round prompt behave exactly as before.

export const ONBOARDING_INTENT_KEY = "golfme:onboardingIntent";

export type OnboardingIntent = "find_people" | "join_round" | "host_round" | "improve_swing";

const INTENTS: readonly OnboardingIntent[] = ["find_people", "join_round", "host_round", "improve_swing"];

export const INTENT_FOCUS_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface StoredIntent {
  v: 1;
  userId: string;
  intents: OnboardingIntent[];
  savedAt: string;
}

export function serializeOnboardingIntent(userId: string, intents: readonly OnboardingIntent[], now: Date): string {
  const unique = INTENTS.filter((i) => intents.includes(i));
  const stored: StoredIntent = { v: 1, userId, intents: unique, savedAt: now.toISOString() };
  return JSON.stringify(stored);
}

// The intents to honour right now for this account: [] when nothing was
// stored, it's malformed or the old format, it belongs to another account,
// or the focus window has passed (or the clock says it was saved in the future).
export function activeOnboardingIntents(raw: string | null | undefined, userId: string | null | undefined, now: Date): OnboardingIntent[] {
  if (!raw || !userId) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const s = parsed as Partial<StoredIntent>;
  if (s.v !== 1 || s.userId !== userId || !Array.isArray(s.intents) || typeof s.savedAt !== "string") return [];
  const savedMs = Date.parse(s.savedAt);
  if (!Number.isFinite(savedMs)) return [];
  const age = now.getTime() - savedMs;
  if (age < 0 || age > INTENT_FOCUS_DAYS * DAY_MS) return [];
  return INTENTS.filter((i) => (s.intents as unknown[]).includes(i));
}

// Which action Home leads with. "golfers": the golfer browser goes first;
// "rounds" and "default" keep Find a Round first (Home's normal layout).
export type HomeFocus = "golfers" | "rounds" | "default";

export function homeFocus(intents: readonly OnboardingIntent[]): HomeFocus {
  if (intents.includes("host_round")) return "default";
  if (intents.includes("join_round")) return "rounds";
  if (intents.includes("find_people")) return "golfers";
  return "default";
}

// A golfer who came to find people or join a round, and didn't also say
// they want to host, isn't pushed to host a first round in that first week
// (the popup and the Home reminder card). Hosting itself stays on Home and
// Rounds as usual.
export function hostingPromptDeferred(intents: readonly OnboardingIntent[]): boolean {
  if (intents.includes("host_round")) return false;
  return intents.includes("find_people") || intents.includes("join_round");
}

// Storage can be unavailable (private mode, blocked site data): then
// nothing is personalized, which is the normal layout.
export function readOnboardingIntents(userId: string | null | undefined, now: Date = new Date()): OnboardingIntent[] {
  try {
    return activeOnboardingIntents(window.localStorage.getItem(ONBOARDING_INTENT_KEY), userId, now);
  } catch {
    return [];
  }
}

export function saveOnboardingIntents(userId: string, intents: readonly OnboardingIntent[], now: Date = new Date()): void {
  try {
    window.localStorage.setItem(ONBOARDING_INTENT_KEY, serializeOnboardingIntent(userId, intents, now));
  } catch {
    // Best-effort personalization only.
  }
}
