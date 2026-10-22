import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useNearbyCourses, useCourseTextSearch } from "../../lib/useCourseSearch";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
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
  /** iOS app only: while the search field has focus and the keyboard is up,
   * dock it and its suggestions to the top of the screen (see below). Only
   * for a field on a normal page -- not inside a modal. */
  dockAboveKeyboard?: boolean;
}

const NEARBY_RADIUS_MILES = 30;
// Gap between the docked panel and the header above / keyboard below.
const DOCK_GAP_PX = 12;

// Single-select course field used by Create Golf Call / Fill My Foursome —
// Recent / Preferred / Near Your Location chips first (reduces typing),
// then free search across every known course via the shared
// CourseSearchService. Picking any known course also reports its area/
// distance so the caller can auto-fill those fields.
export function CourseAutocomplete({ value, onChange, onPickKnownCourse, recentCourses = [], preferredCourses = [], location, dockAboveKeyboard = false }: CourseAutocompleteProps) {
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

  // iOS app (capacitor.config.ts Keyboard resize:"body"): that mode only
  // shrinks document.body's inline height -- the WebView, window.innerHeight
  // and position:fixed stay full-screen, so suggestions opening below the
  // field land behind the keyboard, and scrolling the window to reveal them
  // never moved the page on device. Instead, while this field has focus and
  // the keyboard is up, the field and its suggestions are docked (same
  // technique as PostDetail's composer): the SAME elements (never
  // remounted, so the input keeps focus and the keyboard stays up) switch
  // to a fixed panel just under the app header, inside a frame that ends a
  // gap above the keyboard -- the field sits near the top with room below
  // it, and the suggestions stay above the keyboard (the list scrolls
  // inside itself on short screens). An in-flow slot of the field's height
  // holds its place and the page behind is scroll-locked. keyboardHeight
  // comes from the plugin's own events and is always 0 on web, where
  // nothing here changes.
  const keyboardHeight = useKeyboardHeight();
  const docked = dockAboveKeyboard && focused && keyboardHeight > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  // Measured on focus, while the field is still in flow and before the
  // keyboard starts opening: the slot's height, and the header's bottom
  // edge for the panel's top (the header is sticky, so it doesn't move).
  const [dockLayout, setDockLayout] = useState({ slotHeight: 0, top: 0 });
  // Page scroll position from just before the keyboard opened. iOS may pan
  // the page to reveal the field before it docks; if it did, the page is
  // put back once docked, and again when the keyboard closes.
  const scrollYBeforeKeyboardRef = useRef<number | null>(null);

  function handleFocus() {
    setFocused(true);
    if (!dockAboveKeyboard || docked) return;
    scrollYBeforeKeyboardRef.current = window.scrollY;
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    setDockLayout({ slotHeight: slotRef.current?.offsetHeight ?? 0, top: Math.max(headerBottom, 0) + DOCK_GAP_PX });
  }

  // Layout effect, not a passive one: the scroll lock and the restore to the
  // saved position must land before the docked layout paints, or an
  // iOS-panned page could flash for a frame before snapping back.
  useLayoutEffect(() => {
    if (!docked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const saved = scrollYBeforeKeyboardRef.current;
    if (saved !== null && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      if (restoreTo !== null) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
  }, [docked]);

  function pick(result: CoursePick) {
    onChange(result.name);
    onPickKnownCourse?.(result);
    setFocused(false);
    // A pick from the docked panel is the end of the search: close the
    // keyboard so the page comes back with the course filled in.
    if (docked) inputRef.current?.blur();
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
      {/* Slot -> frame -> panel: the same three elements docked or not (see
          `docked` above), so the input is never remounted. Undocked they're
          plain wrappers and the suggestions drop down over the page as
          before; docked, the frame spans header-to-keyboard (taps outside
          the panel pass through to the page and close the keyboard) and
          the panel inside it is only as tall as its content. */}
      <div ref={slotRef} style={docked ? { height: dockLayout.slotHeight } : undefined}>
        <div
          className={docked ? "pointer-events-none fixed inset-x-0 z-[35] mx-auto flex max-w-3xl flex-col px-4" : "relative"}
          style={docked ? { top: dockLayout.top, bottom: keyboardHeight + DOCK_GAP_PX } : undefined}
        >
          {/* Opted out of useDismissKeyboardOnDrag: the suggestions only show
              while the field has focus, so dragging this list to reach a
              course keeps the keyboard up. A drag elsewhere still closes it. */}
          <div
            data-keyboard-drag-dismiss="off"
            className={docked ? "pointer-events-auto flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-lg" : undefined}
          >
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
                className={`mt-1.5 rounded-xl border border-slate-200 bg-white ${
                  docked ? "min-h-0 overflow-y-auto overscroll-contain" : "absolute z-10 w-full overflow-hidden shadow-sm"
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
      </div>
    </div>
  );
}
