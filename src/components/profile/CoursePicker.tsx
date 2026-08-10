import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { COURSES } from "../../lib/courses";
import { getNearbyCourses } from "../../lib/courseSearch";
import type { PlayingArea } from "../../lib/geo";
import { inputClass } from "../ui/FormControls";

interface CoursePickerProps {
  selected: string[];
  onChange: (courses: string[]) => void;
  /** When provided (with coordinates), shows a "Near Your Area" row of
   * quick-add chips above the search box — real distance-based, from the
   * shared CourseSearchService, not a separate hardcoded regional list. */
  location?: PlayingArea;
}

const NEARBY_RADIUS_MILES = 25;

// Search + tappable-chip pattern rather than a dropdown — reads fine on a
// small screen and scales to a much longer real course list later.
export function CoursePicker({ selected, onChange, location }: CoursePickerProps) {
  const [query, setQuery] = useState("");

  const nearby = useMemo(
    () => (location?.coords ? getNearbyCourses(location, NEARBY_RADIUS_MILES).filter((c) => !selected.includes(c.name)) : []),
    [location, selected],
  );

  const filtered = COURSES.filter((c) => !selected.includes(c) && c.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  function addCourse(course: string) {
    onChange([...selected, course]);
    setQuery("");
  }

  function removeCourse(course: string) {
    onChange(selected.filter((c) => c !== course));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {nearby.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Near Your Area</p>
          <div className="flex flex-wrap gap-1.5">
            {nearby.slice(0, 6).map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => addCourse(c.name)}
                className="inline-flex items-center gap-1 rounded-full border border-fairway-200 bg-fairway-50/70 px-3 py-1.5 text-xs font-medium text-fairway-700 transition-colors duration-150 hover:bg-fairway-100"
              >
                <Plus size={12} /> {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {location?.coords && nearby.length === 0 && (
        <p className="text-xs text-slate-500">No courses found nearby yet — course coverage is currently limited to the New York area. Search below instead.</p>
      )}
      {selected.length === 0 ? (
        <p className="text-sm text-slate-500">No preference — show me anything nearby.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-fairway-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-fairway-700">
              <Check size={12} /> {c}
              <button
                type="button"
                onClick={() => removeCourse(c)}
                aria-label={`Remove ${c}`}
                className="rounded-full p-0.5 text-fairway-500 transition-colors duration-150 hover:bg-fairway-100 hover:text-fairway-800"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        {nearby.length > 0 && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Search All Courses</p>}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courses to add..."
          className={inputClass}
        />
        {query && (
          <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {filtered.length > 0 ? (
              filtered.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addCourse(c)}
                  className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors duration-150 last:border-b-0 hover:bg-fairway-50"
                >
                  <Plus size={13} className="text-fairway-600" /> {c}
                </button>
              ))
            ) : (
              <p className="px-3 py-2.5 text-sm text-slate-400">No courses match "{query}".</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
