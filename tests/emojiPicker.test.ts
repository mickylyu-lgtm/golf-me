// Run: npm run test:chat  (node --test, built-in type stripping)
// The "+" reaction picker's pure parts (lib/emojiPicker.ts): skin tones,
// the per-device recent list and tone, and search over the generated names.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RECENT_EMOJI,
  RECENT_EMOJI_KEY,
  SKIN_TONE_KEY,
  buildSearchIndex,
  normalizeSearch,
  readRecentEmoji,
  readSkinTone,
  rememberRecentEmoji,
  saveSkinTone,
  searchEmoji,
  withSkinTone,
  type KeyValueStorage,
} from "../src/lib/emojiPicker.ts";
import { EMOJI_LIST, GROUP_KEYS, GROUP_STARTS } from "../src/data/emoji/base.ts";
import * as en from "../src/data/emoji/names-en.ts";
import * as es from "../src/data/emoji/names-es.ts";
import * as ja from "../src/data/emoji/names-ja.ts";
import * as ko from "../src/data/emoji/names-ko.ts";
import * as zhCN from "../src/data/emoji/names-zh-CN.ts";
import * as zhTW from "../src/data/emoji/names-zh-TW.ts";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
}
const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
};

test("skin tone: inserted after the first code point, VS16 dropped, default untouched", () => {
  assert.equal(withSkinTone("👍", 0), "👍");
  assert.equal(withSkinTone("👍", 3), "👍🏽");
  assert.equal(withSkinTone("🖐️", 1), "🖐🏻", "VS16 after the base goes");
  assert.equal(withSkinTone("🏌️‍♀️", 5), "🏌🏿‍♀️", "ZWJ rest kept");
  assert.equal(withSkinTone("🧑‍⚕️", 2), "🧑🏼‍⚕️");
});

test("recent emoji: most recent first, deduped, capped, validated", () => {
  const s = memoryStorage();
  assert.deepEqual(readRecentEmoji(s), []);
  rememberRecentEmoji(s, "🔥");
  rememberRecentEmoji(s, "⛳");
  assert.deepEqual(rememberRecentEmoji(s, "🔥"), ["🔥", "⛳"]);
  assert.deepEqual(readRecentEmoji(s), ["🔥", "⛳"]);
  assert.deepEqual(rememberRecentEmoji(s, "not an emoji"), ["🔥", "⛳"], "text never stored");
  const list = EMOJI_LIST.split(" ");
  for (const e of list.slice(0, 40)) rememberRecentEmoji(s, e);
  const recent = readRecentEmoji(s);
  assert.equal(recent.length, MAX_RECENT_EMOJI);
  assert.equal(recent[0], list[39]);
});

test("recent emoji: tampered or broken storage never throws", () => {
  assert.deepEqual(readRecentEmoji(memoryStorage({ [RECENT_EMOJI_KEY]: "{oops" })), []);
  assert.deepEqual(readRecentEmoji(memoryStorage({ [RECENT_EMOJI_KEY]: '{"a":1}' })), []);
  assert.deepEqual(readRecentEmoji(memoryStorage({ [RECENT_EMOJI_KEY]: '["🔥","hello","🔥",3,"⛳"]' })), ["🔥", "⛳"]);
  assert.deepEqual(readRecentEmoji(throwing), []);
  assert.deepEqual(rememberRecentEmoji(throwing, "🔥"), ["🔥"], "returned even when it can't be saved");
  assert.deepEqual(readRecentEmoji(null), []);
});

test("skin tone preference: 0..5 only, broken storage = default", () => {
  const s = memoryStorage();
  assert.equal(readSkinTone(s), 0);
  saveSkinTone(s, 4);
  assert.equal(s.data[SKIN_TONE_KEY], "4");
  assert.equal(readSkinTone(s), 4);
  assert.equal(readSkinTone(memoryStorage({ [SKIN_TONE_KEY]: "9" })), 0);
  assert.equal(readSkinTone(memoryStorage({ [SKIN_TONE_KEY]: "x" })), 0);
  assert.equal(readSkinTone(throwing), 0);
  saveSkinTone(throwing, 2);
});

test("normalize: case, accents and width folded; Hangul and kana intact", () => {
  assert.equal(normalizeSearch("  Corazón "), "corazon");
  assert.equal(normalizeSearch("ＧＯＬＦ"), "golf");
  assert.equal(normalizeSearch("안녕"), "안녕");
  assert.equal(normalizeSearch("がっかり"), "がっかり");
});

const list = EMOJI_LIST.split(" ");
const lines = (m: { NAMES: string }) => m.NAMES.split("\n");

test("data: one name line per emoji in every locale, groups in order", () => {
  for (const m of [en, es, ja, ko, zhCN, zhTW]) {
    assert.equal(lines(m).length, list.length);
    assert.equal(m.GROUP_NAMES.length, GROUP_KEYS.length);
  }
  assert.equal(GROUP_STARTS[0], 0);
  assert.ok(GROUP_STARTS.every((s, i) => i === 0 || s > GROUP_STARTS[i - 1]));
  assert.deepEqual([...GROUP_KEYS], ["smileys-emotion", "people-body", "animals-nature", "food-drink", "travel-places", "activities", "objects", "symbols", "flags"]);
});

test("search: English names and keywords, name matches first", () => {
  const index = buildSearchIndex(list, [lines(en)]);
  const fire = searchEmoji(index, "fire");
  assert.equal(fire[0], "🔥");
  assert.ok(searchEmoji(index, "golf").includes("⛳"));
  assert.ok(searchEmoji(index, "thumbs up").includes("👍"));
  assert.ok(searchEmoji(index, "heart").includes("❤️"));
  assert.deepEqual(searchEmoji(index, "zzzzqqq"), []);
  assert.deepEqual(searchEmoji(index, "   "), []);
  assert.equal(searchEmoji(index, "🔥")[0], "🔥", "a pasted emoji finds itself");
  assert.ok(searchEmoji(index, "a").length <= 120, "capped");
});

test("search: the app's language plus English", () => {
  const esIndex = buildSearchIndex(list, [lines(es), lines(en)]);
  assert.ok(searchEmoji(esIndex, "fuego").includes("🔥"));
  assert.ok(searchEmoji(esIndex, "corazon").some((e) => e.startsWith("❤")), "accent-insensitive");
  assert.ok(searchEmoji(esIndex, "fire").includes("🔥"), "English still works");
  const jaIndex = buildSearchIndex(list, [lines(ja), lines(en)]);
  assert.ok(searchEmoji(jaIndex, "炎").includes("🔥"));
  const koIndex = buildSearchIndex(list, [lines(ko), lines(en)]);
  assert.ok(searchEmoji(koIndex, "불").includes("🔥"));
  const zhIndex = buildSearchIndex(list, [lines(zhCN), lines(en)]);
  assert.ok(searchEmoji(zhIndex, "火").includes("🔥"));
  const twIndex = buildSearchIndex(list, [lines(zhTW), lines(en)]);
  assert.ok(searchEmoji(twIndex, "火").includes("🔥"));
});
