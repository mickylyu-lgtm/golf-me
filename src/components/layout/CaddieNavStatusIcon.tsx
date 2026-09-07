import { useEffect, useRef, useState } from "react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { useData } from "../../context/DataContext";
import { useCaddieNavStatus } from "../../lib/useCaddieNavStatus";

const PULSE_MS = 400;
const SNAP_MS = 350;
// analyze-swing's own comment: the real pipeline "can take up to a minute
// or two." There's no real progress percentage available from the backend
// (it's a single request that returns 'processing' immediately, then does
// the actual work server-side with nothing piped back incrementally) — so
// this is a deliberately optimistic ESTIMATE, capped short of a full
// circle, not a real progress readout. Reaching a full circle is reserved
// for the moment an analysis is actually confirmed complete (the snap
// below) — never implied by elapsed time alone, so this can't finish
// "early" and misrepresent an analysis that's still genuinely running.
const ESTIMATED_DURATION_MS = 75_000;
const ESTIMATED_MOSTLY_DONE_OFFSET = 0.1; // caps at ~90% filled from the estimate alone

interface CaddieNavStatusIconProps {
  size: number;
  strokeWidth: number;
}

// Decorates the existing Caddie mascot nav icon with a live processing
// ring / one-shot completion pulse / unseen-result dot — replaces the old
// full-width CaddieProcessingBanner, which covered header controls and
// only showed while it happened to still be mounted. All the state this
// reads (isProcessing, unseenNotification, caddieAnalyses) already existed
// globally; see useCaddieNavStatus. The mascot itself never resizes or
// moves — only the ring (a separate sibling SVG) animates, and every
// overlay here is pointer-events-none so it can never intercept the tap
// that navigates.
export function CaddieNavStatusIcon({ size, strokeWidth }: CaddieNavStatusIconProps) {
  const { unseenNotification } = useCaddieNavStatus();
  const { caddieAnalyses } = useData();
  const [ringVisible, setRingVisible] = useState(false);
  const [fillOffset, setFillOffset] = useState(1); // pathLength=1 units: 1 = empty, 0 = a full circle
  const [fillTransitionMs, setFillTransitionMs] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const prevProcessingIdsRef = useRef<Set<string>>(new Set());
  const wasProcessingRef = useRef(false);

  useEffect(() => {
    const processingIds = new Set(caddieAnalyses.filter((a) => a.status === "processing").map((a) => a.id));
    const prevIds = prevProcessingIdsRef.current;
    // Tracked by ID, not just a processing/not-processing boolean, so a
    // FAILED analysis can't trigger the completion snap+pulse: analyze-swing
    // deletes a failed row outright rather than ever marking it 'failed'
    // (see its own comment), so a failure means an id simply disappears
    // from caddieAnalyses, while a success means that same id is still
    // there with status 'complete'. Playing the success sequence over a
    // failure would misrepresent it as done, which the spec explicitly
    // calls out not to do.
    const succeeded = [...prevIds].some((id) => !processingIds.has(id) && caddieAnalyses.find((a) => a.id === id)?.status === "complete");
    const nowProcessing = processingIds.size > 0;
    const wasProcessing = wasProcessingRef.current;
    prevProcessingIdsRef.current = processingIds;
    wasProcessingRef.current = nowProcessing;

    if (succeeded) {
      // Ring completes to an actual full circle first, THEN the icon
      // pulses once, THEN the ring is hidden (the dot takes over if
      // there's anything still unseen) — matches the spec's own flow:
      // Analyzing -> Complete (pulse) -> Ready.
      setRingVisible(true);
      setFillTransitionMs(SNAP_MS);
      setFillOffset(0);
      const t1 = setTimeout(() => setPulsing(true), SNAP_MS);
      const t2 = setTimeout(() => setPulsing(false), SNAP_MS + PULSE_MS);
      const t3 = setTimeout(() => {
        setRingVisible(false);
        setFillTransitionMs(0);
        setFillOffset(1);
      }, SNAP_MS + PULSE_MS + 50);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    if (nowProcessing && !wasProcessing) {
      // Fresh start — reset to empty instantly, then kick off the long
      // fill one frame later so the browser actually paints the empty
      // state before the long transition begins (both changes landing in
      // the same paint would skip the visible animation entirely).
      setRingVisible(true);
      setFillTransitionMs(0);
      setFillOffset(1);
      const raf = requestAnimationFrame(() => {
        setFillTransitionMs(ESTIMATED_DURATION_MS);
        setFillOffset(ESTIMATED_MOSTLY_DONE_OFFSET);
      });
      return () => cancelAnimationFrame(raf);
    }

    if (!nowProcessing && !succeeded) {
      // Failure, or nothing has ever run — hide plainly, no snap, no
      // pulse, no dot.
      setRingVisible(false);
      setFillTransitionMs(0);
      setFillOffset(1);
      setPulsing(false);
    }
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
      {ringVisible && (
        <svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="pointer-events-none absolute text-fairway-600"
          aria-hidden="true"
        >
          {/* pathLength=1 makes stroke-dasharray/dashoffset simple 0-1
              fractions of this circle's own length, regardless of its
              actual pixel radius — the same fixed offsets work unchanged
              at both this icon's sizes (bottom nav vs. sidebar). Starts at
              12 o'clock (rotate -90deg) and fills clockwise, like iOS's own
              app-update progress ring, rather than a spinner — a plain CSS
              transition on stroke-dashoffset (no keyframes, no JS loop)
              does the filling; prefers-reduced-motion is already handled
              globally in index.css (collapses every animation/transition
              duration app-wide), so this settles to its end state
              immediately for anyone who needs that. */}
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
            style={{
              strokeDashoffset: fillOffset,
              transition: `stroke-dashoffset ${fillTransitionMs}ms linear`,
              transformBox: "fill-box",
              transformOrigin: "center",
              transform: "rotate(-90deg)",
            }}
          />
        </svg>
      )}
      {!ringVisible && !pulsing && unseenNotification && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-fairway-500 ring-2 ring-white" aria-hidden="true" />
      )}
    </span>
  );
}
