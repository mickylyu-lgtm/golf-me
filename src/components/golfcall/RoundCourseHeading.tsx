import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { roundCourseDestination } from "../../lib/roundCourseLink";

export function RoundCourseHeading({ name, courseId, roundId, isDemo }: {
  name: string;
  courseId?: string;
  roundId: string;
  isDemo: boolean;
}) {
  const to = roundCourseDestination(courseId, isDemo);
  return <h1 className="text-2xl font-extrabold text-slate-900">
    {to ? (
      <Link
        to={to}
        state={{ fromRoundId: roundId }}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded text-fairway-800 underline decoration-fairway-600/40 underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fairway-700"
      >
        <span className="min-w-0 break-words">{name}</span>
        <ChevronRight size={20} className="shrink-0" aria-hidden="true" />
      </Link>
    ) : name}
  </h1>;
}
