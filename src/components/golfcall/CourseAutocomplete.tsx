import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useNearbyCourses, useCourseTextSearch } from "../../lib/useCourseSearch";
import { Capacitor } from "@capacitor/core";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import { wasKeyboardDismissedByDrag } from "../../lib/useDismissKeyboardOnDrag";
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
  /** Suggestions open in normal flow under the field (pushing what follows
   * down) instead of floating over the page, and in the iOS app the page
   * scrolls the field up under the header when the keyboard opens (see
   * below). Only for a field on a normal page -- not inside a modal. */
  inlineSuggestions?: boolean;
}

const NEARBY_RADIUS_MILES = 30;
// Gap kept between the app header and the field when it's scrolled up for
// the iOS keyboard.
const REVEAL_GAP_PX = 12;

// Single-select course field used by Create Golf Call / Fill My Foursome —
// Recent / Preferred / Near Your Location chips first (reduces typing),
// then free search across every known course via the shared
// CourseSearchService. Picking any known course also reports its area/
// distance so the caller can auto-fill those fields.
export function CourseAutocomplete({ value, onChange, onPickKnownCourse, recentCourses = [], preferredCourses = [], location, inlineSuggestions = false }: CourseAutocompleteProps) {
  const { t } = useLocale();
  const [focused, setFocused] = useState(false);

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
  const showDropdown = focused && Boolean(value.trim()) && (searchState.loading || Boolean(searchState.error) || filtered.length > 0);

  // inlineSuggestions (Host a Round): the suggestions open in normal flow
  // under the field, pushing whatever follows (the Next button) down,
  // instead of floating over the page. In the iOS app the field is also
  // scrolled up to sit just under the app header when the keyboard opens,
  // so the suggestions have the space between the field and the keyboard.
  //
  // Why that scroll needs help (capacitor.config.ts Keyboard resize:"body"):
  // that mode only sets document.body's inline height -- window.innerHeight,
  // 100vh and position:fixed stay full-screen, and body's content simply
  // overflows it, so the document's scroll range never grows for the
  // keyboard: max scrollY is still (content height - full screen height).
  // This step is shorter than the screen (AppShell's min-h-screen makes the
  // document exactly one screen tall, scroll range 0), so the earlier
  // scrollBy attempt (21e8de9) had almost nothing to scroll into -- its
  // keyboard-height spacer still left the range well short of what was
  // needed, and that spacer only appeared in the same frame as the scroll.
  // Here, from the moment the field gets focus (before the keyboard even
  // starts opening), an invisible absolutely-positioned spacer hangs from
  // the field: absolutely-positioned boxes count toward the page's
  // scrollable area without moving anything in the layout, and it is
  // exactly tall enough that the page can scroll the field up to just under
  // the header. When the keyboard opens (keyboardWillShow, a separate later
  // event) the window is scrolled there instantly, and put back where it
  // was when the keyboard closes. Nothing here runs on web/PWA, where the
  // browser handles the keyboard itself.
  const isNative = Capacitor.isNativePlatform();
  const keyboardHeight = useKeyboardHeight();
  const revealing = inlineSuggestions && isNative && focused && keyboardHeight > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  // Where the field's top should land, in viewport px: a gap under the
  // header's bottom edge (the header is sticky, so this doesn't move with
  // the page). Measured on focus; also sets the spacer's height.
  const [revealTop, setRevealTop] = useState<number | null>(null);
  // Page scroll position from just before the keyboard opened, restored
  // when it closes.
  const scrollYBeforeKeyboardRef = useRef<number | null>(null);

  function handleFocus() {
    setFocused(true);
    if (!inlineSuggestions || !isNative) return;
    if (keyboardHeight === 0) scrollYBeforeKeyboardRef.current = window.scrollY;
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    setRevealTop(Math.max(headerBottom, 0) + REVEAL_GAP_PX);
  }

  // Layout effect so the scroll lands before the keyboard-open frame paints.
  useLayoutEffect(() => {
    if (!revealing || revealTop === null) return;
    const field = fieldRef.current;
    if (!field) return;
    // Measured now, not on focus: if iOS panned the page while focusing,
    // getBoundingClientRect + scrollY still give the field's page position.
    const target = Math.max(0, Math.round(field.getBoundingClientRect().top + window.scrollY - revealTop));
    window.scrollTo(0, target);
    // Safety net: the plugin resizes the body ~0.5s after keyboardWillShow,
    // and iOS could in principle pan for the focused field on its own. If
    // the page has moved off target by then and the golfer hasn't touched
    // the screen (a drag of the list legitimately scrolls it), put it back.
    let touched = false;
    const onTouch = () => {
      touched = true;
    };
    document.addEventListener("touchstart", onTouch, { capture: true, passive: true });
    const timer = window.setTimeout(() => {
      if (!touched && Math.abs(window.scrollY - target) > 2) window.scrollTo(0, target);
    }, 600);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("touchstart", onTouch, { capture: true });
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      // A drag that closed the keyboard is the golfer scrolling the page
      // themselves -- don't yank it back.
      if (restoreTo !== null && !wasKeyboardDismissedByDrag()) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
    // keyboardHeight changes while typing (e.g. QuickType bar) must not
    // re-scroll; this runs once per keyboard open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing, revealTop]);

  function pick(result: CoursePick) {
    onChange(result.name);
    onPickKnownCourse?.(result);
    setFocused(false);
    // A pick while the keyboard is up is the end of the search: close the
    // keyboard so the page comes back with the course filled in.
    if (revealing) inputRef.current?.blur();
  }

  return (
    <div className="flex flex-col gap-2">
      <CourseSearchStatus loading={nearbyState.loading} error={nearbyState.error} onRetry={nearbyState.retry} />
      {quickPicks.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t("courseAutocomplete.quickPicks")}</p>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => pick(p)}
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
          keyboard) never drops. With inlineSuggestions this component does
          its own keyboard scroll, so it opts out of the app-wide one
          (useRevealFocusedFieldAboveKeyboard). */}
      <div ref={fieldRef} data-keyboard-drag-dismiss="off" data-keyboard-reveal={inlineSuggestions ? "off" : undefined} className="relative">
        {inlineSuggestions && isNative && focused && revealTop !== null && (
          // Invisible scroll room (see `revealing` above): absolutely
          // positioned, so it adds to the page's scroll range without
          // pushing the Next button or anything else down.
          <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0" style={{ height: Math.max(window.innerHeight - revealTop, 0) }} />
        )}
        {quickPicks.length > 0 && <label className={labelClass}>{t("courseAutocomplete.searchAllCourses")}</label>}
        <input
          ref={inputRef}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          placeholder={t("courseAutocomplete.placeholder")}
        />
        {showDropdown && (
          <div
            className={`mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white ${
              inlineSuggestions ? "relative" : "absolute z-10 w-full shadow-sm"
            }`}
          >
            {searchState.loading || searchState.error ? (
              <div className="p-2.5">
                <CourseSearchStatus loading={searchState.loading} error={searchState.error} onRetry={searchState.retry} />
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors duration-150 last:border-b-0 hover:bg-fairway-50"
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
