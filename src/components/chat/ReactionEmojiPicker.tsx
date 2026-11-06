import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Clock, Flag, Hand, Lightbulb, PawPrint, Plane, Search, Shapes, Smile, Trophy, UtensilsCrossed } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import type { TranslationKey } from "../../i18n/locales/en";
import { loadEmojiData, type EmojiData } from "../../lib/emojiData";
import { defaultStorage, readRecentEmoji, readSkinTone, saveSkinTone, searchEmoji, withSkinTone, type SkinTone } from "../../lib/emojiPicker";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";

interface EmojiPickerProps {
  // My current reaction on this message (highlighted; picking it again
  // takes it back, like the quick row).
  mine: string | null;
  onPick: (emoji: string) => void;
  // The overlay is animating out: fade, take no input.
  closing: boolean;
  reducedMotion: boolean;
}

const GROUP_ICONS: Record<string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  "smileys-emotion": Smile,
  "people-body": Hand,
  "animals-nature": PawPrint,
  "food-drink": UtensilsCrossed,
  "travel-places": Plane,
  activities: Trophy,
  objects: Lightbulb,
  symbols: Shapes,
  flags: Flag,
};

const RECENT = "recent";
const CELL_PX = 40;
const HEADING_PX = 28;
const COLUMNS = 8;
const MAX_HEIGHT_PX = 400;
const GAP_PX = 8;

// The sheet's box: the visible area (visualViewport on the web; minus the
// plugin-reported keyboard in the iOS app, where the viewport doesn't
// shrink), inside the safe areas, bottom-anchored.
function useSheetBox(safeTopRef: RefObject<HTMLDivElement | null>, safeBottomRef: RefObject<HTMLDivElement | null>) {
  const keyboard = useKeyboardHeight();
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const measure = useCallback(() => {
    const vv = window.visualViewport;
    const safeTop = safeTopRef.current?.offsetHeight ?? 0;
    const safeBottom = safeBottomRef.current?.offsetHeight ?? 0;
    const vTop = vv ? vv.offsetTop : 0;
    const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const top = Math.max(vTop, safeTop) + GAP_PX;
    const bottom = Math.min(vBottom, window.innerHeight - Math.max(keyboard, safeBottom)) - GAP_PX;
    const height = Math.max(160, Math.min(MAX_HEIGHT_PX, bottom - top));
    setBox({ top: bottom - height, height });
  }, [keyboard, safeTopRef, safeBottomRef]);
  useLayoutEffect(() => {
    measure();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  return box;
}

// The "+" picker in the hold focus overlay (MessageActionsMenu): every
// emoji by category, search (the app's language + English), recently used
// and a skin tone, both remembered on this device. Nothing in it takes the
// focus except the search field when tapped (every button prevents the
// mousedown focus), so an open keyboard stays open; the search field is
// marked so a docked chat composer keeps owning the keyboard meanwhile,
// and MessageActionsMenu hands the focus back on close.
// (Not the composer's small insert-an-emoji popover, chat/EmojiPicker.tsx.)
// Default export: MessageActionsMenu loads it with React.lazy.
export default function ReactionEmojiPicker({ mine, onPick, closing, reducedMotion }: EmojiPickerProps) {
  const { t, locale } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const safeTopRef = useRef<HTMLDivElement>(null);
  const safeBottomRef = useRef<HTMLDivElement>(null);
  const box = useSheetBox(safeTopRef, safeBottomRef);
  const storage = useMemo(() => defaultStorage(), []);
  const [recent] = useState(() => readRecentEmoji(storage));
  const [tone, setTone] = useState<SkinTone>(() => readSkinTone(storage));
  const [toneOpen, setToneOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<EmojiData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState<string>(recent.length > 0 ? RECENT : "smileys-emotion");

  useEffect(() => {
    let live = true;
    setFailed(false);
    loadEmojiData(locale).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [locale, attempt]);

  // Enter: slide up (fade only with reduced motion). Exit: fade with the dim.
  const shown = box !== null;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!shown || !el || typeof el.animate !== "function") return;
    const a = reducedMotion
      ? el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out", fill: "both" })
      : el.animate([{ opacity: 0, transform: "translate3d(0, 24px, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }], { duration: 240, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "both" });
    return () => a.cancel();
  }, [shown, reducedMotion]);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!closing || !el || typeof el.animate !== "function") return;
    const from = getComputedStyle(el).opacity;
    el.animate([{ opacity: from }, { opacity: 0 }], { duration: 120, easing: "ease-in", fill: "both" });
  }, [closing]);

  const shownEmoji = useCallback((index: number) => (data && data.skinTone.has(index) ? withSkinTone(data.emoji[index], tone) : (data?.emoji[index] ?? "")), [data, tone]);
  const indexOf = useMemo(() => new Map(data?.emoji.map((e, i) => [e, i]) ?? []), [data]);
  const results = useMemo(() => (data && query.trim() ? searchEmoji(data.search, query) : null), [data, query]);

  // One listener for the whole grid (1,900 buttons): the button's
  // data-emoji is what gets picked.
  const onGridClick = (e: ReactMouseEvent) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-emoji]");
    const emoji = button?.dataset.emoji;
    if (emoji) onPick(emoji);
  };
  const keepFocus = (e: ReactMouseEvent) => {
    if (!(e.target as Element).closest("input")) e.preventDefault();
  };

  const jumpTo = (key: string) => {
    const scroller = scrollerRef.current;
    const section = scroller?.querySelector<HTMLElement>(`[data-section="${key}"]`);
    if (!scroller || !section) return;
    if (query) setQuery("");
    setActive(key);
    // A jump, like the system keyboard's emoji tabs: a smooth scroll across
    // thousands of px of not-yet-rendered sections drifts and takes long.
    scroller.scrollTo({ top: section.offsetTop, behavior: "auto" });
  };
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller || results) return;
    let current = active;
    for (const s of scroller.querySelectorAll<HTMLElement>("[data-section]")) {
      if (s.offsetTop <= scroller.scrollTop + HEADING_PX) current = s.dataset.section ?? current;
    }
    if (current !== active) setActive(current);
  };

  const cell = (emoji: string, label: string, key: string | number) => (
    <button
      key={key}
      type="button"
      data-emoji={emoji}
      aria-label={label}
      aria-pressed={mine === emoji}
      title={label}
      // Exact px height: the sections' intrinsic size estimate depends on it.
      style={{ height: CELL_PX }}
      className={`flex items-center justify-center rounded-lg text-[1.6rem] leading-none select-none hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 ${
        mine === emoji ? "bg-fairway-100" : ""
      }`}
    >
      <span aria-hidden="true">{emoji}</span>
    </button>
  );
  const labelFor = (emoji: string) => {
    const i = indexOf.get(emoji) ?? indexOf.get(emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/u, ""));
    return i !== undefined && data ? data.names[i] || emoji : emoji;
  };
  const section = (key: string, title: string, items: { emoji: string; label: string }[]) => {
    const rows = Math.ceil(items.length / COLUMNS);
    return (
      <section
        key={key}
        data-section={key}
        aria-label={title}
        // Off-screen sections skip layout/paint; the size is exact (fixed
        // cell and heading heights), so offsets for the tabs stay right.
        style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${HEADING_PX + rows * CELL_PX}px` }}
      >
        <h3 className="flex items-end px-1 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase" style={{ height: HEADING_PX }}>
          {title}
        </h3>
        <div className="grid grid-cols-8">{items.map((it, i) => cell(it.emoji, it.label, i))}</div>
      </section>
    );
  };

  const tones: SkinTone[] = [0, 1, 2, 3, 4, 5];
  const tabs = [...(recent.length > 0 ? [{ key: RECENT, name: t("emojiPicker.recent"), Icon: Clock }] : []), ...(data?.groups ?? []).map((g) => ({ key: g.key, name: g.name, Icon: GROUP_ICONS[g.key] ?? Shapes }))];

  return (
    <>
      <div ref={safeTopRef} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 h-[env(safe-area-inset-top)] w-px" />
      <div ref={safeBottomRef} aria-hidden="true" className="pointer-events-none invisible fixed bottom-0 left-0 h-[env(safe-area-inset-bottom)] w-px" />
      <div
        ref={rootRef}
        role="dialog"
        aria-label={t("emojiPicker.title")}
        aria-hidden={closing || undefined}
        data-emoji-picker
        // Dragging the grid must not close the keyboard (useDismissKeyboardOnDrag).
        data-keyboard-drag-dismiss="off"
        onMouseDown={keepFocus}
        // Portalled next to the hold overlay (same z-50, later = on top);
        // no input while the overlay animates out.
        className={`fixed inset-x-0 z-50 mx-auto w-full px-2 sm:max-w-md sm:px-0 ${closing ? "pointer-events-none" : ""}`}
        style={box ? { top: box.top, height: box.height, opacity: 0 } : { top: 0, height: 0, visibility: "hidden" }}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl dark:border-slate-200 dark:bg-slate-100">
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 text-slate-500 dark:bg-slate-200">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                // A docked composer keeps the keyboard (useComposerFocus).
                data-keeps-composer-focus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("emojiPicker.search")}
                aria-label={t("emojiPicker.search")}
                className="min-w-0 flex-1 bg-transparent text-base text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
            </label>
            <button
              type="button"
              aria-label={t("emojiPicker.skinTone")}
              aria-expanded={toneOpen}
              onClick={() => setToneOpen((o) => !o)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[1.3rem] leading-none hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400"
            >
              <span aria-hidden="true">{withSkinTone("✋", tone)}</span>
            </button>
          </div>
          {toneOpen && (
            <div role="radiogroup" aria-label={t("emojiPicker.skinTone")} className="flex justify-end gap-1 px-3 pb-2">
              {tones.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={tone === n}
                  aria-label={t(`emojiPicker.tone${n}` as TranslationKey)}
                  data-tone={n}
                  onClick={() => {
                    setTone(n);
                    saveSkinTone(storage, n);
                    setToneOpen(false);
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[1.3rem] leading-none hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 ${
                    tone === n ? "bg-fairway-100" : ""
                  }`}
                >
                  <span aria-hidden="true">{withSkinTone("✋", n)}</span>
                </button>
              ))}
            </div>
          )}
          <div role="tablist" aria-label={t("emojiPicker.categories")} className="flex shrink-0 justify-between border-b border-slate-100 px-2 pb-1 dark:border-slate-200">
            {tabs.map(({ key, name, Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={!results && active === key}
                aria-label={name}
                data-tab={key}
                onClick={() => jumpTo(key)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 motion-reduce:transition-none ${
                  !results && active === key ? "bg-fairway-100 text-fairway-700" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <Icon size={16} aria-hidden={true} />
              </button>
            ))}
          </div>
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            onClick={onGridClick}
            data-emoji-scroller
            // relative: sections' offsetTop is measured from here (tabs, onScroll).
            className="relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 pb-2"
          >
            {failed ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
                <p>{t("emojiPicker.loadFailed")}</p>
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200">
                  {t("loading.retry")}
                </button>
              </div>
            ) : !data ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-500" role="status">
                {t("emojiPicker.loading")}
              </p>
            ) : results ? (
              results.length > 0 ? (
                section(
                  "results",
                  t("emojiPicker.search"),
                  results.map((e) => {
                    const i = indexOf.get(e) ?? -1;
                    return { emoji: i >= 0 ? shownEmoji(i) : e, label: i >= 0 ? data.names[i] || e : e };
                  }),
                )
              ) : (
                <p className="py-8 text-center text-sm text-slate-500" role="status">
                  {t("emojiPicker.noResults")}
                </p>
              )
            ) : (
              <>
                {recent.length > 0 && section(RECENT, t("emojiPicker.recent"), recent.map((e) => ({ emoji: e, label: labelFor(e) })))}
                {data.groups.map((g) => {
                  const items: { emoji: string; label: string }[] = [];
                  for (let i = g.start; i < g.end; i++) items.push({ emoji: shownEmoji(i), label: data.names[i] || data.emoji[i] });
                  return section(g.key, g.name, items);
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
