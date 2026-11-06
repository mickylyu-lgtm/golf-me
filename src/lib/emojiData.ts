// Lazy loader for the "+" picker's emoji list and names (generated into
// src/data/emoji by scripts/emoji/build-emoji-data.mjs). Each file is its
// own chunk, fetched the first time a picker opens: the list (~15 KB) and
// the names of the app's language plus English (search always works in
// English). Nothing here is in the main bundle.
import type { Locale } from "../i18n/LocaleContext";
import { buildSearchIndex, type EmojiSearchEntry } from "./emojiPicker";

interface NamesModule {
  GROUP_NAMES: readonly string[];
  NAMES: string;
}

const NAME_LOADERS: Record<Locale, () => Promise<NamesModule>> = {
  en: () => import("../data/emoji/names-en"),
  es: () => import("../data/emoji/names-es"),
  ja: () => import("../data/emoji/names-ja"),
  ko: () => import("../data/emoji/names-ko"),
  "zh-CN": () => import("../data/emoji/names-zh-CN"),
  "zh-TW": () => import("../data/emoji/names-zh-TW"),
};

export interface EmojiGroup {
  key: string;
  name: string;
  start: number;
  end: number;
}

export interface EmojiData {
  emoji: readonly string[];
  groups: readonly EmojiGroup[];
  skinTone: ReadonlySet<number>;
  // Display name per emoji, in the app's language (English when missing).
  names: readonly string[];
  search: readonly EmojiSearchEntry[];
}

const cache = new Map<Locale, Promise<EmojiData>>();

export function loadEmojiData(locale: Locale): Promise<EmojiData> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const promise = (async () => {
    const [base, en, loc] = await Promise.all([
      import("../data/emoji/base"),
      NAME_LOADERS.en(),
      locale === "en" ? Promise.resolve(null) : NAME_LOADERS[locale](),
    ]);
    const emoji = base.EMOJI_LIST.split(" ");
    const enLines = en.NAMES.split("\n");
    const locLines = loc ? loc.NAMES.split("\n") : null;
    const groupNames = (loc ?? en).GROUP_NAMES;
    const groups = base.GROUP_KEYS.map((key, i) => ({
      key,
      name: groupNames[i] ?? en.GROUP_NAMES[i] ?? key,
      start: base.GROUP_STARTS[i],
      end: base.GROUP_STARTS[i + 1] ?? emoji.length,
    }));
    const names = emoji.map((_, i) => (locLines?.[i] || enLines[i] || "").split("\t")[0]);
    return {
      emoji,
      groups,
      skinTone: new Set(base.SKIN_TONE_INDICES),
      names,
      search: buildSearchIndex(emoji, locLines ? [locLines, enLines] : [enLines]),
    };
  })();
  // A failed chunk load (offline) may be retried on the next open.
  promise.catch(() => cache.delete(locale));
  cache.set(locale, promise);
  return promise;
}
