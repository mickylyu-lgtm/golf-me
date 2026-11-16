// Abstract, on-brand placeholder for a course with no known photo --
// fairway green gradient sky, a soft rolling hill, and a single flag
// silhouette. Intentionally not detailed enough to be mistaken for a
// specific real course (never a generated "photo" of a real place).
export function GenericCourseIllustration() {
  return (
    <svg viewBox="0 0 400 225" className="h-full w-full" role="img" aria-label="Golf course illustration" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="course-hero-sky" x1="0" y1="0" x2="0" y2="1">
          {/* Dark appearance: a dusk version (dark: classes override the attributes). */}
          <stop offset="0%" stopColor="#f0fdf4" className="dark:[stop-color:#101b15]" />
          <stop offset="100%" stopColor="#dcfce7" className="dark:[stop-color:#14271b]" />
        </linearGradient>
      </defs>
      <rect width="400" height="225" fill="url(#course-hero-sky)" />
      <path d="M0,160 C90,120 150,190 240,145 C300,115 350,150 400,130 L400,225 L0,225 Z" fill="#bbf7d0" className="dark:fill-[#1a3b26]" />
      <path d="M0,190 C110,165 220,205 400,170 L400,225 L0,225 Z" fill="#86efac" className="dark:fill-[#245236]" />
      <circle cx="292" cy="120" r="4" fill="#166534" className="dark:fill-[#a9e6bf]" />
      <line x1="292" y1="120" x2="292" y2="88" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" className="dark:stroke-[#a9e6bf]" />
      <path d="M292,88 L316,96 L292,104 Z" fill="#22c55e" />
    </svg>
  );
}
