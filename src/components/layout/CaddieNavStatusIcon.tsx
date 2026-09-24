import { useEffect, useRef, useState } from "react";
import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import { useData } from "../../context/DataContext";
import { useCaddieNavStatus } from "../../lib/useCaddieNavStatus";
import { isStaleProcessing } from "../../lib/caddieAnalysis";

const PULSE_MS = 700;
const SPARK_ANGLES = [-18, 0, 18];
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

// Ring hugs the icon at a size-PROPORTIONAL gap, not a flat px addition --
// root cause of the collapsed-BottomNav clipping bug: the old flat `size +
// 7` barely shrank between the expanded (24px) and collapsed (21px) icon
// sizes, so the ring needed almost the same clearance in both states even
// though the collapsed nav's own padding budget is much smaller. Exported
// so BottomNav.tsx can reserve exactly this much box space for the Caddie
// tab specifically -- one formula, so the two can never drift apart.
export function caddieRingSize(iconSize: number): number {
  return Math.round(iconSize * 1.2);
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
  // Stale rows (pipeline killed, row left at 'processing' forever) don't
  // count as in-flight. useCaddieNavStatus above re-renders periodically
  // while anything is processing; this key is what re-runs the effect when
  // a row crosses the stale mark, since caddieAnalyses itself never changes.
  const liveProcessingKey = caddieAnalyses
    .filter((a) => a.status === "processing" && !isStaleProcessing(a))
    .map((a) => a.id)
    .join(",");

  useEffect(() => {
    const processingRows = caddieAnalyses.filter((a) => a.status === "processing" && !isStaleProcessing(a));
    const processingIds = new Set(processingRows.map((a) => a.id));
    const prevIds = prevProcessingIdsRef.current;
    // Tracked by ID, not just a processing/not-processing boolean, so a
    // FAILED analysis can't trigger the completion snap+pulse: this only
    // fires when that same id is still present with status 'complete' —
    // a row that stopped processing because it failed instead persists
    // with status 'failed' (analyze-swing marks it, never deletes it —
    // see its own fail() comment), which doesn't satisfy this check.
    // Playing the success sequence over a failure would misrepresent it
    // as done, which the spec explicitly calls out not to do.
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
      // Fires both on a genuine fresh start AND after a page reload mid-
      // analysis (this component just remounted with no memory of when the
      // fill actually began) — reported live as the ring restarting from
      // empty on every refresh. createdAt is real, persisted data (not
      // component-local state), so computing elapsed time from it instead
      // of always assuming "just started now" fixes both cases at once:
      // resume from wherever the real elapsed time already puts it, then
      // keep filling for only whatever's left of the estimate.
      setRingVisible(true);
      const earliestCreatedAt = Math.min(...processingRows.map((a) => new Date(a.createdAt).getTime()));
      const elapsedMs = Math.max(Date.now() - earliestCreatedAt, 0);
      const progress = Math.min(elapsedMs / ESTIMATED_DURATION_MS, 1);
      const currentOffset = 1 - progress * (1 - ESTIMATED_MOSTLY_DONE_OFFSET);
      const remainingMs = Math.max(ESTIMATED_DURATION_MS - elapsedMs, 0);
      setFillTransitionMs(0);
      setFillOffset(currentOffset);
      // Next frame so the browser actually paints the resumed-from-here
      // state before the remaining transition begins (both changes landing
      // in the same paint would skip the visible animation entirely).
      const raf = requestAnimationFrame(() => {
        setFillTransitionMs(remainingMs);
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
  }, [caddieAnalyses, liveProcessingKey]);

  // Visually separated from the mascot but hugging it closely (reported
  // live as too large a gap in an earlier pass) — sized off the icon's own
  // size so it scales correctly across every caller (bottom nav collapsed/
  // expanded, desktop sidebar). Stroke thins slightly at the compact size
  // so it stays visually balanced rather than looking heavy on a smaller
  // ring (per the collapsed-nav sizing pass).
  const ringSize = caddieRingSize(size);
  const radius = ringSize / 2 - 1.5;
  const ringStrokeWidth = size <= 21 ? 1.6 : 2;

  return (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: ringSize, height: ringSize, transition: "width 200ms ease-out, height 200ms ease-out" }}
    >
      <CaddieNavIcon size={size} strokeWidth={strokeWidth} className={pulsing ? "animate-caddie-pulse" : undefined} />
      {/* One soft outward halo — distinct from the processing ring below
          (which fills in place) — plus 2-3 small spark marks above the
          mascot, both firing only during the same ~700ms completion
          window as the icon's own scale. */}
      {pulsing && (
        <>
          <span className="pointer-events-none absolute inset-0 animate-caddie-pulse-halo rounded-full bg-fairway-500" aria-hidden="true" />
          {SPARK_ANGLES.map((angle, i) => (
            <span
              key={angle}
              className="pointer-events-none absolute left-1/2 top-0"
              style={{ transform: `translateX(-50%) translateY(-4px) rotate(${angle}deg)` }}
              aria-hidden="true"
            >
              <span className="block h-1.5 w-0.5 animate-caddie-pulse-spark rounded-full bg-fairway-500" style={{ animationDelay: `${i * 40}ms` }} />
            </span>
          ))}
        </>
      )}
      {ringVisible && (
        <svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className={`pointer-events-none absolute text-fairway-600 transition-opacity duration-300 ${pulsing ? "opacity-0" : "opacity-100"}`}
          style={{ transition: "width 200ms ease-out, height 200ms ease-out" }}
          aria-hidden="true"
        >
          {/* pathLength=1 makes stroke-dasharray/dashoffset simple 0-1
              fractions of this circle's own length, regardless of its
              actual pixel radius — the same fixed offsets work unchanged
              at every size this renders at (collapsed/expanded bottom nav,
              sidebar). Starts at 12 o'clock (rotate -90deg) and fills
              clockwise, like iOS's own app-update progress ring, rather
              than a spinner — a plain CSS transition on stroke-dashoffset
              (no keyframes, no JS loop) does the filling; cx/cy/r each get
              their own 200ms transition too (same duration as BottomNav's
              own collapse/expand) so a resize glides the ring to its new
              size instead of snapping — this is pure geometry, so it can't
              touch or reset fillOffset, which is what actually carries the
              real fill progress across a resize. prefers-reduced-motion is
              already handled globally in index.css (collapses every
              animation/transition duration app-wide), so all of this
              settles to its end state immediately for anyone who needs
              that. */}
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringStrokeWidth}
            strokeLinecap="round"
            strokeDasharray={1}
            style={{
              strokeDashoffset: fillOffset,
              transition: `stroke-dashoffset ${fillTransitionMs}ms linear, cx 200ms ease-out, cy 200ms ease-out, r 200ms ease-out`,
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
