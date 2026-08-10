import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { COURSES, areaForCourse } from "../../lib/courses";
import { getNearbyCourses } from "../../lib/courseSearch";
import type { PlayingArea } from "../../lib/geo";
import { inputClass, labelClass } from "../ui/FormControls";

interface CoursePick {
  name: string;
  area?: string;
  distanceMiles?: number;
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
  const [focused, setFocused] = useState(false);

  const nearby = useMemo(
    () => (location?.coords ? getNearbyCourses(location, NEARBY_RADIUS_MILES).map((c) => c.name) : []),
    [location],
  );

  const quickPicks = useMemo(() => {
    const seen = new Set<string>();
    const picks: { label: string; name: string }[] = [];
    for (const name of recentCourses) {
      if (seen.has(name)) continue;
      seen.add(name);
      picks.push({ label: "Recent", name });
    }
    for (const name of preferredCourses) {
      if (seen.has(name)) continue;
      seen.add(name);
      picks.push({ label: "Preferred", name });
    }
    for (const name of nearby) {
      if (seen.has(name)) continue;
      seen.add(name);
      picks.push({ label: "Near You", name });
    }
    return picks.slice(0, 6);
  }, [recentCourses, preferredCourses, nearby]);

  const filtered = value.trim() ? COURSES.filter((c) => c.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 6) : [];

  function pick(name: string) {
    onChange(name);
    onPickKnownCourse?.({ name, area: areaForCourse(name) });
    setFocused(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {quickPicks.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Quick Picks</p>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => pick(p.name)}
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
        location?.coords && <p className="text-xs text-slate-500">No known courses nearby yet — search for any course below.</p>
      )}
      <div className="relative">
        {quickPicks.length > 0 && <label className={labelClass}>Search All Courses</label>}
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          placeholder="e.g. Bethpage Red"
        />
        {focused && filtered.length > 0 && (
          <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors duration-150 last:border-b-0 hover:bg-fairway-50"
              >
                <Plus size={13} className="text-fairway-600" /> {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
