import { RotateCcw } from "lucide-react";
import { GolfMeLoader } from "../loading/GolfMeLoader";

// Shared loading/error row for every real-course-search surface (CoursePicker,
// CourseAutocomplete, ProfileSetup's nearby-courses step) — real accounts
// never silently fall back to fixture data on a provider failure, they get
// this instead. Demo mode never renders this (its search is synchronous and
// never errors), so `error`/`loading` are only ever true for real accounts.
export function CourseSearchStatus({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <GolfMeLoader size="sm" message="Searching courses..." />;
  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
        <p className="text-xs text-red-700">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100"
        >
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  }
  return null;
}
