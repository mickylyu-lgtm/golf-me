// Run: npm run test:chat  (node --test, built-in type stripping)
// One reaction emoji (lib/reactionEmoji.ts), the rule the database's
// is_reaction_emoji() check also applies (migration 20261107160000).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_REACTION_EMOJI_BYTES, buildReactionEmojiPattern, isReactionEmoji, reactionEmojiClasses, utf8Length } from "../src/lib/reactionEmoji.ts";
import { EMOJI_LIST, SKIN_TONE_INDICES } from "../src/data/emoji/base.ts";
import { SKIN_TONES, withSkinTone } from "../src/lib/emojiPicker.ts";

const MIGRATION = new URL("../supabase/migrations/20261107160000_custom_reaction_emoji.sql", import.meta.url);

// Invisible pieces, spelled out.
const VS16 = "\u{FE0F}";
const ZWJ = "\u{200D}";
const KEYCAP = "\u{20E3}";
const ZWSP = "\u{200B}";
const cps = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16)).join(" ");

test("reaction emoji: single emoji of every shape are accepted", () => {
  const ok = [
    "🔥", "⛳", "😂", // emoji presentation
    `\u{2764}${VS16}`, `\u{263A}${VS16}`, `\u{A9}${VS16}`, `\u{2122}${VS16}`, // text default + VS16
    "👍🏽", "\u{261D}\u{1F3FB}", "🏌🏿", // skin tones (a text-default modifier base too)
    "🇯🇵", "🇺🇸", "🇪🇺", // flags
    `1${VS16}${KEYCAP}`, `#${VS16}${KEYCAP}`, `*${KEYCAP}`, // keycaps (VS16 optional)
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", // England
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", // Scotland
    ["👨", "👩", "👧", "👦"].join(ZWJ), // family
    `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`, // rainbow flag
    `\u{1F3F3}${VS16}${ZWJ}\u{26A7}${VS16}`, // transgender flag
    `\u{2764}${VS16}${ZWJ}\u{1F525}`, // heart on fire
    ["🧑", "🤝", "🧑"].join(ZWJ),
    `\u{1F3CC}${VS16}${ZWJ}\u{2640}${VS16}`, // woman golfing
    `\u{1F3CC}\u{1F3FB}${ZWJ}\u{2642}${VS16}`, // man golfing, light skin
    `\u{1F441}${VS16}${ZWJ}\u{1F5E8}${VS16}`, // eye in speech bubble
    `\u{1FAF1}\u{1F3FB}${ZWJ}\u{1FAF2}\u{1F3FF}`, // handshake, two tones
    `\u{1F469}\u{1F3FD}${ZWJ}\u{2764}${VS16}${ZWJ}\u{1F48B}${ZWJ}\u{1F468}\u{1F3FB}`, // kiss, two tones
    `\u{1F9D1}\u{1F3FB}${ZWJ}\u{2764}${VS16}${ZWJ}\u{1F48B}${ZWJ}\u{1F9D1}\u{1F3FC}`, // longest RGI (35 bytes)
    "\u{1FAF9}", "\u{1FAF9}\u{1F3FB}", // Emoji 18 (not yet assigned in Unicode 17): accepted, with a tone too
  ];
  for (const e of ok) assert.equal(isReactionEmoji(e), true, `${e} ${cps(e)}`);
});

test("reaction emoji: text, digits, whitespace, several emoji, empty, too long are refused", () => {
  const bad: unknown[] = [
    "", " ", "\n", "\t", "a", "ok", "lol", "1", "42", "#", "*", "😀 ", " 😀", `😀${ZWSP}`,
    "😀😀", "🔥⛳", "🇯🇵🇺🇸", "👍👍🏽", "🇯🇵🇺", // two emoji side by side / odd flags
    "\u{2764}", "\u{A9}", "\u{263A}", // text default without VS16
    "😀🏻", // skin tone on a non-modifier base
    "🏻", "🇯", ZWJ, VS16, KEYCAP, ZWSP, // lone components
    `😀${ZWJ}`, `${ZWJ}😀`, `😀${ZWJ}${ZWJ}😀`, // dangling / doubled ZWJ
    ["👨", "👩", "👧", "👦", "👦"].join(ZWJ), // five ZWJ elements
    "\u{1F3F4}\u{E0067}\u{E0062}", // tag flag without its cancel tag
    `a${KEYCAP}`, `1${KEYCAP}${KEYCAP}`,
    "<script>", "😀a", "a😀", "é", "中",
    null, undefined, 7, ["🔥"],
  ];
  for (const v of bad) assert.equal(isReactionEmoji(v), false, typeof v === "string" ? `${JSON.stringify(v)} ${cps(v)}` : String(v));
});

test("reaction emoji: the byte cap", () => {
  assert.equal(MAX_REACTION_EMOJI_BYTES, 48);
  assert.equal(utf8Length(`\u{1F9D1}\u{1F3FB}${ZWJ}\u{2764}${VS16}${ZWJ}\u{1F48B}${ZWJ}\u{1F9D1}\u{1F3FC}`), 35, "longest RGI emoji fits");
  assert.equal(utf8Length("a"), 1);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("\u{2764}"), 3);
  assert.equal(utf8Length("🔥"), 4);
  // Structurally valid but over the cap: 4 x (tone base + tone) + 3 ZWJ = 41
  // bytes fits; with a tag flag's maximum (7 tags) it's 4 + 28 + 4 = 36.
  const family = ["👩🏽", "👩🏽", "👧🏽", "👦🏽"].join(ZWJ);
  assert.equal(utf8Length(family), 41);
  assert.equal(isReactionEmoji(family), true);
});

test("reaction emoji: every emoji the picker offers (and every skin tone) is accepted", () => {
  const list = EMOJI_LIST.split(" ");
  assert.ok(list.length > 1800);
  for (const e of list) assert.equal(isReactionEmoji(e), true, `${e} ${cps(e)}`);
  for (const i of SKIN_TONE_INDICES) {
    for (let t = 1; t <= SKIN_TONES.length; t++) {
      const toned = withSkinTone(list[i], t as 1 | 2 | 3 | 4 | 5);
      assert.equal(isReactionEmoji(toned), true, `${toned} ${cps(toned)}`);
    }
  }
});

test("reaction emoji: the migration declares exactly the client's generated classes", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const classes = reactionEmojiClasses("pg");
  const declared = (name: string) => sql.match(new RegExp(`${name} constant text := '([^']*)';`))?.[1];
  assert.equal(declared("c_presentation"), classes.presentation);
  assert.equal(declared("c_text_default"), classes.textDefault);
  assert.equal(declared("c_modifier_base"), classes.modifierBase);
  assert.equal(declared("c_skin_tone"), "[\\U0001F3FB-\\U0001F3FF]");
  assert.match(sql, /octet_length\(p_emoji\) > 48/, "same byte cap");
  assert.match(sql, /\)\{0,3\}\)\$'/, "same ZWJ element cap");
  // Escapes only (no invisible characters in the file), and only ones a
  // Postgres ARE knows.
  for (const invisible of [ZWSP, ZWJ, "\u{200C}", VS16, KEYCAP]) assert.equal(sql.includes(invisible), false, `U+${invisible.codePointAt(0)!.toString(16)}`);
  const pg = buildReactionEmojiPattern("pg");
  assert.doesNotMatch(pg, /\\u/);
  assert.match(pg, /^\^\(\?:\[\\U0001F1E6-\\U0001F1FF\]\{2\}\|/);
});

test("reaction emoji: the JS pattern is anchored and never matches ASCII", () => {
  const js = buildReactionEmojiPattern("js");
  assert.ok(js.startsWith("^(?:") && js.endsWith(")$"));
  const re = new RegExp(js, "u");
  for (let c = 0; c < 0x80; c++) assert.equal(re.test(String.fromCharCode(c)), false, `U+${c.toString(16)}`);
});
