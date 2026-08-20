import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Home } from "../../pages/Home";
import { Find } from "../../pages/Find";
import { Inbox } from "../../pages/Inbox";
import { Caddie } from "../../pages/Caddie";
import { Profile } from "../../pages/Profile";

// The 5 root sections, in swipe order — Home / Chat / Play / Caddie / Me,
// matching NAV_ITEMS (Play centered as the single most important tab).
// Kept in this file (rather than deriving from MOBILE_NAV_ITEMS) because it
// also needs the actual page components, not just icons/labels. Hosting a
// round is reached via an action button, not a root tab, so it renders as a
// normal pushed route (/golf-calls/new) outside this carousel. My Golf
// moved off the root tabs (now a row on the Me/Profile page) when Caddie
// took its slot, so MyRounds is no longer one of these panels. Chat's own
// path (/messages) is a root tab, but an individual thread (/messages/:id)
// is not — AppShell only renders this carousel for exact ROOT_PATHS
// matches, so opening a conversation naturally falls through to a normal
// pushed route instead of activating tab-swipe underneath it.
const PANELS = [
  { path: "/", render: () => <Home /> },
  { path: "/messages", render: () => <Inbox /> },
  { path: "/find", render: () => <Find /> },
  { path: "/caddie", render: () => <Caddie /> },
  { path: "/profile", render: () => <Profile /> },
] as const;

// A flick past either threshold commits the swipe; falling short of both
// snaps back. Distance alone handles a slow deliberate drag, velocity alone
// handles a fast short flick.
const DISTANCE_THRESHOLD_PX = 64;
const VELOCITY_THRESHOLD_PX_PER_MS = 0.35;
// Horizontal movement must clearly dominate vertical before we claim the
// gesture — a mostly-vertical scroll (e.g. reading Golf Calls) must never
// get hijacked into a tab change.
const DIRECTION_RATIO = 1.2;
// Movement below this, in either axis, isn't enough to even guess intent
// yet — avoids jitter/tap noise deciding the gesture prematurely.
const DECISION_DEADZONE_PX = 8;
// A touch that starts on a button/link/row needs a clearly more deliberate
// drag before it's read as a swipe rather than a tap — most of a typical
// screen here (Home/Play/Me especially) is covered edge-to-edge by
// clickable cards, so requiring the swipe to start on bare background would
// leave almost nowhere to actually swipe from. These wider thresholds keep
// a normal tap on a card reliable (small finger jitter stays under them)
// while still letting an intentional horizontal drag starting ON a card
// change tabs, instead of refusing to track the touch at all.
const INTERACTIVE_DECISION_DEADZONE_PX = 20;
const INTERACTIVE_DIRECTION_RATIO = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Sliders (and anything explicitly opted out via [data-no-swipe]) need a
// full exclusion, not just a stricter threshold — a drag handle has to
// track every pixel of finger movement with zero risk of ever being
// reinterpreted as a tab change, so touch tracking never even starts here.
function isSliderTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest('[role="slider"], [data-no-swipe]'));
}

// Buttons/links/inputs are different: a plain tap must stay reliable, but
// most of a typical screen here (Home/Play/Me especially) is covered
// edge-to-edge by clickable cards, so fully excluding them (as this used
// to) would leave almost nowhere to actually start a swipe from. These get
// a stricter deadzone/direction check below instead of a full exclusion —
// small tap jitter stays a tap, a clearly deliberate horizontal drag can
// still change tabs.
function isTappableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest("button, a, input, textarea, select"));
}

interface TouchTrack {
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastTime: number;
  decided: boolean;
  isHorizontalSwipe: boolean;
  startedOnInteractive: boolean;
}

// Persistent-mounted carousel of the 5 root tabs — all 5 stay alive at
// once (translated off-screen via `left`, not `transform`, so page-level
// modals using position:fixed still measure against the real viewport
// instead of a transformed ancestor) so swiping between them preserves
// each tab's in-page state, and settles with a native-feeling drag instead
// of an instant cut.
export function RootTabCarousel({ activePath }: { activePath: string }) {
  const navigate = useNavigate();
  const activeIndex = Math.max(
    0,
    PANELS.findIndex((p) => p.path === activePath),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<TouchTrack | null>(null);
  const [dragOffsetPct, setDragOffsetPct] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function offsetPctFromDx(dx: number): number {
      const width = container!.clientWidth || 1;
      let pct = (dx / width) * 100;
      // Resist (rather than ignore) dragging past the first/last tab —
      // "Home + swipe right stays on Home" reads as a soft edge, not a wall.
      if ((activeIndex === 0 && pct > 0) || (activeIndex === PANELS.length - 1 && pct < 0)) {
        pct /= 3;
      }
      return pct;
    }

    function onTouchStart(e: TouchEvent) {
      if (isSliderTarget(e.target)) {
        touchRef.current = null;
        return;
      }
      const t = e.touches[0];
      touchRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
        lastX: t.clientX,
        lastTime: Date.now(),
        decided: false,
        isHorizontalSwipe: false,
        startedOnInteractive: isTappableTarget(e.target),
      };
    }

    function onTouchMove(e: TouchEvent) {
      const state = touchRef.current;
      if (!state) return;
      const t = e.touches[0];
      const dx = t.clientX - state.startX;
      const dy = t.clientY - state.startY;

      if (!state.decided) {
        const deadzone = state.startedOnInteractive ? INTERACTIVE_DECISION_DEADZONE_PX : DECISION_DEADZONE_PX;
        const directionRatio = state.startedOnInteractive ? INTERACTIVE_DIRECTION_RATIO : DIRECTION_RATIO;
        if (Math.abs(dx) < deadzone && Math.abs(dy) < deadzone) return;
        state.decided = true;
        state.isHorizontalSwipe = Math.abs(dx) > Math.abs(dy) * directionRatio;
        if (!state.isHorizontalSwipe) {
          touchRef.current = null; // hand off to native scroll / the element's own tap entirely
          return;
        }
      }
      if (!state.isHorizontalSwipe) return;

      // Only now do we actually take the gesture over from native scroll.
      e.preventDefault();
      state.lastX = t.clientX;
      state.lastTime = Date.now();
      setDragging(true);
      setDragOffsetPct(offsetPctFromDx(dx));
    }

    function finishGesture() {
      const state = touchRef.current;
      touchRef.current = null;
      if (!state || !state.isHorizontalSwipe) {
        setDragging(false);
        setDragOffsetPct(0);
        return;
      }

      const totalDx = state.lastX - state.startX;
      const elapsedMs = Math.max(1, state.lastTime - state.startTime);
      const velocity = Math.abs(totalDx) / elapsedMs;

      let nextIndex = activeIndex;
      if (Math.abs(totalDx) >= DISTANCE_THRESHOLD_PX || velocity >= VELOCITY_THRESHOLD_PX_PER_MS) {
        if (totalDx < 0 && activeIndex < PANELS.length - 1) nextIndex = activeIndex + 1;
        else if (totalDx > 0 && activeIndex > 0) nextIndex = activeIndex - 1;
      }

      setDragging(false);
      setDragOffsetPct(0);
      if (nextIndex !== activeIndex) navigate(PANELS[nextIndex].path);
    }

    // touchmove must be non-passive for preventDefault() to actually stop
    // native scroll once we've claimed the gesture — React's JSX touch
    // handlers are passive by default and silently ignore preventDefault.
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", finishGesture, { passive: true });
    container.addEventListener("touchcancel", finishGesture, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", finishGesture);
      container.removeEventListener("touchcancel", finishGesture);
    };
  }, [activeIndex, navigate]);

  const reducedMotion = prefersReducedMotion();
  const leftPct = -activeIndex * 100 + dragOffsetPct;

  return (
    <div ref={containerRef} className="overflow-x-hidden">
      <div
        ref={trackRef}
        className="flex items-start"
        style={{
          width: `${PANELS.length * 100}%`,
          position: "relative",
          left: `${leftPct}%`,
          transition: dragging || reducedMotion ? "none" : "left 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {PANELS.map(({ path, render }) => (
          <div key={path} style={{ width: `${100 / PANELS.length}%` }} className="min-w-0 shrink-0">
            {render()}
          </div>
        ))}
      </div>
    </div>
  );
}
