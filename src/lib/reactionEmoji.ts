// What counts as ONE reaction emoji (the "+" picker's custom reactions, and
// the six quick ones). Same rule as the database check added by migration
// 20261107160000_custom_reaction_emoji (public.is_reaction_emoji): its
// three class constants are reactionEmojiClasses("pg") of these same ranges
// (tests/reactionEmoji.test.ts compares them) and it assembles them exactly
// like buildReactionEmojiPattern (the PGlite suite compares the two on every
// emoji in the dataset plus random strings).
//
// Exactly one of:
//   * a flag: two regional indicators (🇯🇵);
//   * a keycap: 0-9 # * (U+FE0F optional) U+20E3 (1️⃣);
//   * a tag flag: 🏴 + 1..7 tag letters + cancel tag (England, Scotland, Wales);
//   * up to 4 emoji joined by ZWJ (U+200D), each optionally with U+FE0F, or
//     with ONE skin tone when it's a modifier base. The first (or only) one
//     needs U+FE0F when its default is text (❤️ yes, bare ❤ no).
// And at most MAX_REACTION_EMOJI_BYTES of UTF-8. Never plain text, digits,
// spaces, two emoji side by side or an empty string.
//
// Why a structural pattern instead of an exact list of the ~3,800 RGI
// sequences: the database can check it in a CHECK constraint (no allow-list
// table to keep in step with every Unicode release), it accepts emoji newer
// than our picker's list (another phone's keyboard), and what it lets
// through beyond RGI (a ZWJ pair no vendor draws) still renders as at most
// four emoji glyphs, never text. No React imports: runs under plain node.
import { MODIFIER_BASE_RANGES, PRESENTATION_RANGES, TEXT_DEFAULT_RANGES, type CodePointRange } from "./reactionEmojiRanges.ts";

// The longest RGI emoji (kiss/couple with two skin tones) is 35 bytes; the
// structure itself can't exceed 41 (4 x toned base + 3 ZWJ), so the cap is
// a backstop.
export const MAX_REACTION_EMOJI_BYTES = 48;
export const MAX_ZWJ_ELEMENTS = 4;

type Flavor = "js" | "pg";

function cp(n: number, flavor: Flavor): string {
  const h = n.toString(16).toUpperCase();
  // Postgres: always the 8-digit \U form (one spelling for every code point).
  return flavor === "js" ? `\\u{${h}}` : `\\U${h.padStart(8, "0")}`;
}

function cls(ranges: readonly CodePointRange[], flavor: Flavor): string {
  return "[" + ranges.map(([a, b]) => (a === b ? cp(a, flavor) : `${cp(a, flavor)}-${cp(b, flavor)}`)).join("") + "]";
}

// The three generated classes as bracket expressions. The migration's
// is_reaction_emoji() declares exactly these "pg" strings as constants.
export function reactionEmojiClasses(flavor: Flavor): { presentation: string; textDefault: string; modifierBase: string } {
  return { presentation: cls(PRESENTATION_RANGES, flavor), textDefault: cls(TEXT_DEFAULT_RANGES, flavor), modifierBase: cls(MODIFIER_BASE_RANGES, flavor) };
}

// The anchored pattern, for JavaScript (`u` flag) or Postgres (ARE, `~`).
export function buildReactionEmojiPattern(flavor: Flavor): string {
  const c = (n: number) => cp(n, flavor);
  const { presentation: P, textDefault: T, modifierBase: MB } = reactionEmojiClasses(flavor);
  const MOD = `[${c(0x1f3fb)}-${c(0x1f3ff)}]`;
  const VS = c(0xfe0f);
  const first = `(?:${MB}${MOD}|${P}${VS}?|${T}${VS})`;
  const next = `(?:${MB}${MOD}|${P}${VS}?|${T}${VS}?)`;
  const seq = `${first}(?:${c(0x200d)}${next}){0,${MAX_ZWJ_ELEMENTS - 1}}`;
  const flag = `[${c(0x1f1e6)}-${c(0x1f1ff)}]{2}`;
  const keycap = `[0-9#*]${VS}?${c(0x20e3)}`;
  const tagFlag = `${c(0x1f3f4)}[${c(0xe0020)}-${c(0xe007e)}]{1,7}${c(0xe007f)}`;
  return `^(?:${flag}|${keycap}|${tagFlag}|${seq})$`;
}

const REACTION_EMOJI_RE = new RegExp(buildReactionEmojiPattern("js"), "u");

export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const v = ch.codePointAt(0) ?? 0;
    n += v < 0x80 ? 1 : v < 0x800 ? 2 : v < 0x10000 ? 3 : 4;
  }
  return n;
}

export function isReactionEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && utf8Length(value) <= MAX_REACTION_EMOJI_BYTES && REACTION_EMOJI_RE.test(value);
}
