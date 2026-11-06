// The "+" emoji picker's pure parts (components/chat/EmojiPicker.tsx):
// skin tones, the per-device recently-used list and preferred tone, and the
// search over names/keywords. No React imports and no DOM access at import
// time, so tests/emojiPicker.test.ts runs under plain node.
import { isReactionEmoji } from "./reactionEmoji.ts";

export const SKIN_TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"] as const;
// 0 = default (yellow), 1..5 = SKIN_TONES[tone - 1].
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

// The tone goes right after the first code point (an U+FE0F there is
// dropped: 🖐️ -> 🖐🏽). The data generator only marks emoji whose five
// toned forms follow exactly this rule (scripts/emoji/build-emoji-data.mjs).
export function withSkinTone(emoji: string, tone: SkinTone): string {
  if (tone === 0) return emoji;
  const cps = [...emoji];
  const rest = cps.slice(1);
  if (rest[0] === "\u{FE0F}") rest.shift();
  return cps[0] + SKIN_TONES[tone - 1] + rest.join("");
}

// ---------------------------------------------------------------------------
// Per-device storage (localStorage, every access guarded: private mode,
// blocked storage and previews just mean nothing is remembered).
// ---------------------------------------------------------------------------
export interface KeyValueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const RECENT_EMOJI_KEY = "golfme:recent-reactions:v1";
export const SKIN_TONE_KEY = "golfme:emoji-skin-tone:v1";
export const MAX_RECENT_EMOJI = 24;

export function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readRecentEmoji(storage: KeyValueStorage | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_EMOJI_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const e of parsed) if (isReactionEmoji(e) && !out.includes(e)) out.push(e);
    return out.slice(0, MAX_RECENT_EMOJI);
  } catch {
    return [];
  }
}

// Most recent first, no duplicates, at most MAX_RECENT_EMOJI. Returns the
// new list (also when it couldn't be saved).
export function rememberRecentEmoji(storage: KeyValueStorage | null, emoji: string): string[] {
  const current = readRecentEmoji(storage);
  if (!isReactionEmoji(emoji)) return current;
  const next = [emoji, ...current.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJI);
  try {
    storage?.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
  } catch {
    // Not remembered this time.
  }
  return next;
}

export function readSkinTone(storage: KeyValueStorage | null): SkinTone {
  try {
    const n = Number(storage?.getItem(SKIN_TONE_KEY));
    return Number.isInteger(n) && n >= 0 && n <= 5 ? (n as SkinTone) : 0;
  } catch {
    return 0;
  }
}

export function saveSkinTone(storage: KeyValueStorage | null, tone: SkinTone): void {
  try {
    storage?.setItem(SKIN_TONE_KEY, String(tone));
  } catch {
    // Not remembered this time.
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// Case- and accent-insensitive (es: "corazon" finds "corazón"), full-width
// folded (NFKC); Hangul and kana keep their marks (NFD then NFKC recomposes).
export function normalizeSearch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u{300}-\u{36F}]/gu, "").normalize("NFKC").trim();
}

export interface EmojiSearchEntry {
  emoji: string;
  index: number;
  // Normalized; the first one of each locale is the emoji's name.
  names: string[];
  words: string[];
}

// `nameLines[l][i]` = "name\tkeyword\t..." of EMOJI i in locale l (the
// app's locale and English: a golfer can always search in English).
export function buildSearchIndex(emoji: readonly string[], nameLines: readonly (readonly string[])[]): EmojiSearchEntry[] {
  return emoji.map((e, index) => {
    const names: string[] = [];
    const words = new Set<string>();
    for (const lines of nameLines) {
      const parts = (lines[index] ?? "").split("\t").map(normalizeSearch).filter(Boolean);
      if (parts[0]) names.push(parts[0]);
      for (const p of parts) {
        words.add(p);
        for (const w of p.split(/[\s:,.\-_/()]+/u)) if (w) words.add(w);
      }
    }
    return { emoji: e, index, names, words: [...words] };
  });
}

// Every query token must match: exactly a name, exactly a keyword, a name
// starting with it, a keyword starting with it, then one containing it
// (what CJK queries mostly use), in that order.
// Ties keep Unicode order. An emoji typed or pasted finds itself.
export function searchEmoji(index: readonly EmojiSearchEntry[], query: string, limit = 120): string[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const tokens = q.split(/\s+/u).filter(Boolean);
  const scored: { emoji: string; score: number; index: number }[] = [];
  for (const entry of index) {
    if (entry.emoji === query.trim()) {
      scored.push({ emoji: entry.emoji, score: -1, index: entry.index });
      continue;
    }
    let score = 0;
    let all = true;
    for (const t of tokens) {
      let best = Infinity;
      if (entry.names.includes(t)) best = 0;
      else if (entry.words.includes(t)) best = 1;
      else if (entry.names.some((n) => n.startsWith(t))) best = 2;
      else if (entry.words.some((w) => w.startsWith(t))) best = 3;
      else if (entry.words.some((w) => w.includes(t))) best = 4;
      if (best === Infinity) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) scored.push({ emoji: entry.emoji, score, index: entry.index });
  }
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.emoji);
}
