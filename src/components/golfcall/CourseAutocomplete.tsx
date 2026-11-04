import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, Plus } from "lucide-react";
import { useNearbyCourses, useCourseTextSearch } from "../../lib/useCourseSearch";
import { Capacitor } from "@capacitor/core";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import { KEYBOARD_GAP_PX } from "../../lib/revealFocusedField";
import { revealDelta } from "../../lib/minimalReveal";
import { createFrameScheduler } from "../../lib/frameScheduler";
import type { PlayingArea } from "../../lib/geo";
import { inputClass, labelClass } from "../ui/FormControls";
import { CourseSearchStatus } from "../ui/CourseSearchStatus";
import { useLocale } from "../../i18n/LocaleContext";

interface CoursePick {
  id?: string; // courses.id — only present for a real (Geoapify-backed) pick
  name: string;
  area?: string;
  distanceMiles?: number;
  lat?: number;
  lng?: number;
}

interface CourseAutocompleteProps {
  value: string;
  onChange: (course: string) => void;
  /** Fired only when a known course is picked from a chip/suggestion (not
   * on free typing) — lets the caller auto-fill area/distance and reduce
   * typing, per the "Recent / Preferred / Near Your Location" flow. */
  onPickKnownCourse?: (pick: CoursePick) => void;
  recentCourses?: string[];
  preferredCourses?: string[];
  location?: PlayingArea;
  /** On a normal page in the iOS app, this component keeps the field and
   * its first suggestions above the keyboard itself (see below) instead of
   * the app-wide reveal. Leave off inside a modal: the sheet's own scroller
   * handles it there. */
  inlineSuggestions?: boolean;
}

const NEARBY_RADIUS_MILES = 30;
// Gap kept between the app header and the field.
const REVEAL_GAP_PX = 12;
// Room wanted under the field for suggestions: about two and a half rows,
// enough to see there are results without pushing the field far up.
const SUGGESTION_ROOM_PX = 132;
const BLUR_CLOSE_MS = 150;

// Single-select course field used by Create Golf Call / Fill My Foursome —
// Recent / Preferred / Near Your Location chips first (reduces typing),
// then free search across every known course via the shared
// CourseSearchService. Picking any known course also reports its area/
// distance so the caller can auto-fill those fields.
export function CourseAutocomplete({ value, onChange, onPickKnownCourse, recentCourses = [], preferredCourses = [], location, inlineSuggestions = false }: CourseAutocompleteProps) {
  const { t } = useLocale();
  const [focused, setFocused] = useState(false);
  // Escape (or picking) hides the list until the golfer types again.
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();

  const nearbyState = useNearbyCourses(location, NEARBY_RADIUS_MILES);
  const nearbyByName = useMemo(() => new Map(nearbyState.results.map((r) => [r.name, r])), [nearbyState.results]);

  const quickPicks = useMemo(() => {
    const seen = new Set<string>();
    const picks: (CoursePick & { label: string })[] = [];
    for (const name of recentCourses) {
      if (seen.has(name)) continue;
      seen.add(name);
      picks.push({ label: t("courseAutocomplete.recent"), name, ...nearbyByName.get(name) });
    }
    for (const name of preferredCourses) {
      if (seen.has(name)) continue;
      seen.add(name);
      picks.push({ label: t("courseAutocomplete.preferred"), name, ...nearbyByName.get(name) });
    }
    for (const r of nearbyState.results) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      picks.push({ label: t("courseAutocomplete.nearYou"), ...r });
    }
    return picks.slice(0, 6);
  }, [recentCourses, preferredCourses, nearbyState.results, nearbyByName, t]);

  const searchState = useCourseTextSearch(value, location, 6);
  const filtered = searchState.results;
  const hasQuery = Boolean(value.trim());
  // The list stays open (with a "no results" row) once a search has run, so
  // it doesn't blink shut and back open between keystrokes.
  const noResults = hasQuery && !searchState.loading && !searchState.error && filtered.length === 0;
  const showDropdown = focused && !dismissed && hasQuery && (searchState.loading || Boolean(searchState.error) || filtered.length > 0 || noResults);

  // ── Keeping the field above the iOS keyboard (inlineSuggestions only) ──
  // capacitor.config.ts uses Keyboard resize:"body", which only sets
  // document.body's inline height: window.innerHeight and the document's
  // scroll range don't change for the keyboard, and Host a Round's step is
  // shorter than the screen (scroll range ~0). So, while the field has
  // focus, an invisible absolutely-positioned spacer hangs off it to give
  // the page room to scroll (it moves nothing in the layout).
  //
  // The page is then scrolled by the SMALLEST amount that puts the field and
  // ~2.5 suggestion rows between the header and the keyboard
  // (lib/minimalReveal), and not at all when they already fit. It's checked
  // again only when something actually moved: the keyboard height changed,
  // or content above the field resized (the nearby-course chips arriving).
  // No timed re-scroll and no snapping back to an older position on close
  // (Micky, 2026-11-04: the field "jumps toward the top"). Nothing here
  // runs on web/PWA, where the browser handles the keyboard itself.
  const isNative = Capacitor.isNativePlatform();
  const keyboardHeight = useKeyboardHeight();
  const revealing = inlineSuggestions && isNative && focused && keyboardHeight > 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!revealing) return;
    const keep = () => {
      const input = inputRef.current;
      // Only while this field still has the keyboard: a check that arrives
      // after it lost focus must never move the page.
      if (!input || document.activeElement !== input) return;
      const rect = input.getBoundingClientRect();
      const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const delta = revealDelta({
        fieldTop: rect.top,
        fieldBottom: rect.bottom,
        room: SUGGESTION_ROOM_PX,
        visibleTop: Math.max(headerBottom, 0) + REVEAL_GAP_PX,
        visibleBottom: window.innerHeight - keyboardHeight - KEYBOARD_GAP_PX,
      });
      if (delta !== 0) window.scrollBy(0, delta);
    };
    keep();
    // Content above the field resizing (chips, status rows) and the
    // plugin's body resize after the keyboard opens are the only things
    // that can move the field from here; re-check on those, at most once a
    // frame. Cleanup (blur, keyboard closed or resized, unmount) cancels a
    // queued check so it can't fire late with the old keyboard height.
    const scheduler = createFrameScheduler(keep, (cb) => window.requestAnimationFrame(cb), (id) => window.cancelAnimationFrame(id));
    const observer = new ResizeObserver(() => scheduler.schedule());
    if (rootRef.current) observer.observe(rootRef.current);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      scheduler.dispose();
    };
  }, [revealing, keyboardHeight]);

  // A blur closes the list a moment later (so a tap on a suggestion still
  // lands); refocusing in that moment keeps it open.
  const blurTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    },
    [],
  );

  function handleFocus() {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setFocused(true);
  }

  function handleBlur() {
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = null;
      setFocused(false);
      setActiveIndex(-1);
    }, BLUR_CLOSE_MS);
  }

  function pick(result: CoursePick) {
    onChange(result.name);
    onPickKnownCourse?.(result);
    setDismissed(true);
    setActiveIndex(-1);
    // A pick while the keyboard is up is the end of the search: close the
    // keyboard so the page comes back with the course filled in.
    if (revealing) inputRef.current?.blur();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Mid-composition keys (Chinese / Japanese / Korean IME) belong to the
    // input method, never to the list.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!showDropdown || filtered.length === 0) {
      if (e.key === "Escape") setDismissed(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      pick(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <CourseSearchStatus loading={nearbyState.loading} error={nearbyState.error} onRetry={nearbyState.retry} />
      {quickPicks.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("courseAutocomplete.quickPicks")}</p>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((p) => (
              <button
                key={p.id ?? p.name}
                type="button"
                // Tapping the selected pick again unselects it (Micky, 2026-11-03).
                onClick={() => (value === p.name ? onChange("") : pick(p))}
                aria-pressed={value === p.name}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  value === p.name
                    ? "border-transparent bg-fairway-600 text-white"
                    : "border-fairway-200 bg-fairway-50/70 text-fairway-700 hover:bg-fairway-100"
                }`}
              >
                {value === p.name ? <Check size={12} /> : <Plus size={12} />}
                {p.name} <span className="opacity-60">· {p.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        location?.coords && !nearbyState.loading && !nearbyState.error && (
          <p className="text-xs text-slate-500">{t("courseAutocomplete.noNearbyCourses")}</p>
        )
      )}
      {/* Opted out of useDismissKeyboardOnDrag: the suggestions only show
          while the field has focus, so dragging this list to reach a course
          keeps the keyboard up. A drag elsewhere still closes it. The input
          is never remounted or moved between parents, so focus (and the
          keyboard) never drops. With inlineSuggestions this component keeps
          itself above the keyboard, so it opts out of the app-wide reveal
          (useRevealFocusedFieldAboveKeyboard). */}
      <div data-keyboard-drag-dismiss="off" data-keyboard-reveal={inlineSuggestions ? "off" : undefined} className="relative">
        {inlineSuggestions && isNative && (focused || keyboardHeight > 0) && (
          // Invisible scroll room (see above): absolutely positioned, so it
          // adds to the page's scroll range without moving anything. Kept
          // until the keyboard has finished closing, so the page settles
          // back together with the keyboard rather than jumping after it.
          <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0" style={{ height: window.innerHeight }} />
        )}
        {quickPicks.length > 0 && <label className={labelClass}>{t("courseAutocomplete.searchAllCourses")}</label>}
        <input
          ref={inputRef}
          className={inputClass}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setDismissed(false);
            setActiveIndex(-1);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={t("courseAutocomplete.placeholder")}
          maxLength={120}
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listId : undefined}
          aria-activedescendant={showDropdown && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        />
        {showDropdown && (
          // In normal flow under the field everywhere (a floating list was
          // clipped inside sheets), and bounded: it scrolls itself instead
          // of growing the page.
          <div id={listId} role="listbox" className="relative mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white">
            {/* Real search refetches 300 ms after each keystroke: keep the
                previous suggestions tappable meanwhile instead of blanking
                the list to a spinner on every letter. */}
            {searchState.error || (searchState.loading && filtered.length === 0) ? (
              <div className="p-2.5">
                <CourseSearchStatus loading={searchState.loading} error={searchState.error} onRetry={searchState.retry} />
              </div>
            ) : noResults ? (
              <p className="px-3 py-2.5 text-sm text-slate-500">{t("courseAutocomplete.noResults")}</p>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.id ?? `${c.name}|${c.area ?? ""}`}
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className={`flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors duration-150 last:border-b-0 hover:bg-fairway-50 ${
                    i === activeIndex ? "bg-fairway-50" : ""
                  }`}
                >
                  <Plus size={13} className="text-fairway-600 shrink-0" />
                  <span className="flex-1">{c.name}</span>
                  {c.area && <span className="shrink-0 text-xs text-slate-400">{c.area}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
