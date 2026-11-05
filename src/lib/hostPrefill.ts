// "Host a round" from an Auto-Match that found nothing: Host a Round opens
// with the golfer's own preferences already picked (round length, game
// format, a Networking vibe for a golfer open to networking) and the day
// they searched for. CreateGolfCall reads these as starting values only; a
// saved Host Round draft still wins, the same as its existing when/date
// params.
//
// Pure (no React, explicit .ts imports) so tests/autoMatchLadder.test.ts
// can run it under node --test.
import type { GameFormat, GolfVibe, Holes, SkillFilter, WalkOrCart } from "../types/index.ts";
import { GAME_FORMATS, GOLF_VIBES } from "../types/index.ts";
import type { NewPreferenceSelections } from "./preferenceMatch.ts";
import type { WhenChoice } from "./roundSearchParams.ts";

const SKILLS: SkillFilter[] = ["Any Skill Level", "Beginner", "Intermediate", "Advanced"];
const WALKS: WalkOrCart[] = ["Either", "Walking", "Cart"];

export interface HostPrefill {
  holes: Holes | null;
  gameFormat: GameFormat | null;
  vibe: GolfVibe | null;
  walkOrCart: WalkOrCart | null;
  skillLevel: SkillFilter | null;
}

export interface HostPrefillInput {
  when: WhenChoice | null;
  customDate: string | null;
  prefs: NewPreferenceSelections;
  walk: WalkOrCart | null;
  skill: SkillFilter | null;
}

export function hostPrefillSearch(input: HostPrefillInput): URLSearchParams {
  const params = new URLSearchParams();
  if (input.when === "date") {
    if (input.customDate) {
      params.set("when", "date");
      params.set("date", input.customDate);
    }
  } else if (input.when) {
    params.set("when", input.when);
  }
  const { roundLengthPreference, gameFormatPreference, networkingPreference } = input.prefs;
  if (roundLengthPreference === "9 Holes") params.set("holes", "9");
  if (roundLengthPreference === "18 Holes") params.set("holes", "18");
  if (gameFormatPreference !== "No Preference") params.set("format", gameFormatPreference);
  if (networkingPreference === "Open to Networking" || networkingPreference === "Business / Professional Networking") {
    params.set("vibe", "Networking");
  }
  if (input.walk && input.walk !== "Either") params.set("walk", input.walk);
  if (input.skill && input.skill !== "Any Skill Level") params.set("skill", input.skill);
  return params;
}

function oneOf<T extends string>(value: string | null, options: readonly T[]): T | null {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : null;
}

// Unknown values read as "not set", never as a broken form.
export function parseHostPrefill(params: URLSearchParams): HostPrefill {
  const holes = params.get("holes");
  return {
    holes: holes === "9" ? 9 : holes === "18" ? 18 : null,
    gameFormat: oneOf(params.get("format"), GAME_FORMATS),
    vibe: oneOf(params.get("vibe"), GOLF_VIBES),
    walkOrCart: oneOf(params.get("walk"), WALKS),
    skillLevel: oneOf(params.get("skill"), SKILLS),
  };
}
