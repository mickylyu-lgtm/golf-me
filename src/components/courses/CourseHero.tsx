import { useState } from "react";
import { MapPin } from "lucide-react";

interface CourseHeroProps {
  courseName: string;
  city: string;
  state: string;
  imageUrl?: string;
  imageCredit?: string;
}

// Wide landscape hero for a course-detail screen -- a real, legitimately-
// licensed photo when one is known (see SupportedTeeTimeCourse's own
// comments for how that's verified per course), otherwise a hand-built,
// clearly-generic illustration. Never a generated/fake "photo" presented
// as the real course -- the illustration is deliberately abstract
// (rolling fairway + flag, no specific course details) so it can't be
// mistaken for photography of any particular place.
export function CourseHero({ courseName, city, state, imageUrl, imageCredit }: CourseHeroProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-fairway-50">
        {showImage ? (
          <img
            src={imageUrl}
            alt={`${courseName}, ${city}, ${state}`}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <GenericCourseIllustration />
        )}
        {/* Small location pill -- only adds value on top of a real photo,
            where the course's own identity isn't already obvious from the
            (deliberately generic) illustration underneath it. */}
        {showImage && (
          <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            <MapPin size={11} className="shrink-0" />
            {city}, {state}
          </span>
        )}
      </div>
      {showImage && imageCredit && <p className="mt-1 text-right text-[10px] text-slate-400">{imageCredit}</p>}
    </div>
  );
}

// Abstract, on-brand placeholder -- fairway green gradient sky, a soft
// rolling hill, and a single flag silhouette. Intentionally not detailed
// enough to be mistaken for a specific real course.
function GenericCourseIllustration() {
  return (
    <svg viewBox="0 0 400 225" className="h-full w-full" role="img" aria-label="Golf course illustration" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="course-hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0fdf4" />
          <stop offset="100%" stopColor="#dcfce7" />
        </linearGradient>
      </defs>
      <rect width="400" height="225" fill="url(#course-hero-sky)" />
      <path d="M0,160 C90,120 150,190 240,145 C300,115 350,150 400,130 L400,225 L0,225 Z" fill="#bbf7d0" />
      <path d="M0,190 C110,165 220,205 400,170 L400,225 L0,225 Z" fill="#86efac" />
      <circle cx="292" cy="120" r="4" fill="#166534" />
      <line x1="292" y1="120" x2="292" y2="88" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M292,88 L316,96 L292,104 Z" fill="#22c55e" />
    </svg>
  );
}
