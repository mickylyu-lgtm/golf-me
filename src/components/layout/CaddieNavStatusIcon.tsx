import { useEffect, useRef, useState } from "react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { useData } from "../../context/DataContext";
import { useCaddieNavStatus } from "../../lib/useCaddieNavStatus";

const PULSE_MS = 400;

interface CaddieNavStatusIconProps {
  size: number;
  strokeWidth: number;
}

// Decorates the existing Caddie mascot nav icon with a live processing
// ring / one-shot completion pulse / unseen-result dot — replaces the old
// full-width CaddieProcessingBanner, which covered header controls and
// only showed while it happened to still be mounted. All the state this
// reads (isProcessing, unseenNotification, caddieAnalyses) already existed
// globally; see useCaddieNavStatus. The mascot itself never resizes,
// moves, or spins — only the ring (a separate sibling SVG) rotates, and
// every overlay here is pointer-events-none so it can never intercept the
// tap that navigates.
export function CaddieNavStatusIcon({ size, strokeWidth }: CaddieNavStatusIconProps) {
  const { isProcessing, unseenNotification } = useCaddieNavStatus();
  const { caddieAnalyses } = useData();
  const [pulsing, setPulsing] = useState(false);
  const prevProcessingIdsRef = useRef<Set<string>>(new Set());

  // Tracked by ID, not just a processing/not-processing boolean, so a
  // FAILED analysis can't trigger this: analyze-swing deletes a failed
  // row outright rather than ever marking it 'failed' (see its own
  // comment), so a failure means an id simply disappears from
  // caddieAnalyses, while a success means that same id is still there with
  // status 'complete'. Only the latter is the one completion pulse the
  // spec asks for — playing it over a failure would misrepresent it as
  // done, which the spec explicitly calls out not to do.
  useEffect(() => {
    const processingIds = new Set(caddieAnalyses.filter((a) => a.status === "processing").map((a) => a.id));
    const prevIds = prevProcessingIdsRef.current;
    const succeeded = [...prevIds].some((id) => !processingIds.has(id) && caddieAnalyses.find((a) => a.id === id)?.status === "complete");
    prevProcessingIdsRef.current = processingIds;
    if (!succeeded) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(timer);
  }, [caddieAnalyses]);

  // Visually separated from the mascot but hugging it closely (reported
  // live as too large a gap in an earlier pass) — sized off the icon's own
  // size so it scales correctly between the bottom nav (28px) and the
  // desktop sidebar (24px).
  const ringSize = size + 7;
  const radius = ringSize / 2 - 1.5;

  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: ringSize, height: ringSize }}>
      <CaddieNavIcon size={size} strokeWidth={strokeWidth} className={pulsing ? "animate-caddie-pulse" : undefined} />
      {isProcessing && (
        <svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="pointer-events-none absolute text-fairway-600"
          aria-hidden="true"
        >
          {/* pathLength=1 makes stroke-dasharray/dashoffset simple 0-1
              fractions of this circle's own length, regardless of its
              actual pixel radius — see the animate-caddie-ring comment in
              index.css for why that lets one fixed keyframe pair work at
              both this icon's sizes. prefers-reduced-motion is already
              handled globally there too (collapses every animation-duration
              app-wide), so this renders as a static partial ring for anyone
              who needs that, with no extra variant here. */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={1}
            className="animate-caddie-ring"
          />
        </svg>
      )}
      {!isProcessing && unseenNotification && !pulsing && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-fairway-500 ring-2 ring-white" aria-hidden="true" />
      )}
    </span>
  );
}
