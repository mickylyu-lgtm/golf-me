import type { GolfVibe, SkillFilter, WalkOrCart } from "../types";
import type { TranslationKey } from "../i18n/locales/en";

// The stored/compared value for these three enums stays the fixed English
// literal from types.ts everywhere (form state, filters, matching,
// database columns) — only ever swap in the translated label at the point
// of display, via these lookups, so nothing that compares values breaks.
type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const VIBE_KEYS: Record<GolfVibe, TranslationKey> = {
  "Casual & Social": "vibe.casualSocial",
  Competitive: "vibe.competitive",
  "Beginner-Friendly": "vibe.beginnerFriendly",
  Networking: "vibe.networking",
  "Just Here to Golf": "vibe.justHereToGolf",
};

const SKILL_KEYS: Record<SkillFilter, TranslationKey> = {
  "Any Skill Level": "skill.any",
  Beginner: "skill.beginner",
  Intermediate: "skill.intermediate",
  Advanced: "skill.advanced",
};

const WALK_OR_CART_KEYS: Record<WalkOrCart, TranslationKey> = {
  Walking: "walkOrCart.walking",
  Cart: "walkOrCart.cart",
  Either: "walkOrCart.either",
};

export function vibeLabel(vibe: GolfVibe, t: TFn): string {
  return t(VIBE_KEYS[vibe]);
}

export function skillLabel(skill: SkillFilter, t: TFn): string {
  return t(SKILL_KEYS[skill]);
}

export function walkOrCartLabel(walkOrCart: WalkOrCart, t: TFn): string {
  return t(WALK_OR_CART_KEYS[walkOrCart]);
}
