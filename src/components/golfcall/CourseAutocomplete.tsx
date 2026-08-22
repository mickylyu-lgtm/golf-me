import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useNearbyCourses, useCourseTextSearch } from "../../lib/useCourseSearch";
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
}

const NEARBY_RADIUS_MILES = 30;

// Single-select course field used by Create Golf Call / Fill My Foursome —
// Recent / Preferred / Near Your Location chips first (reduces typing),
// then free search across every known course via the shared
// CourseSearchService. Picking any known course also reports its area/
// distance so the caller can auto-fill those fields.
export function CourseAutocomplete({ value, onChange, onPickKnownCourse, recentCourses = [], preferredCourses = [], location }: CourseAutocompleteProps) {
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

  function pick(result: CoursePick) {
    onChange(result.name);
    onPickKnownCourse?.(result);
    setFocused(false);
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
      <div className="relative">
        {quickPicks.length > 0 && <label className={labelClass}>{t("courseAutocomplete.searchAllCourses")}</label>}
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          placeholder={t("courseAutocomplete.placeholder")}
        />
        {focused && value.trim() && (searchState.loading || searchState.error || filtered.length > 0) && (
          <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
