export interface TutorialRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

export function sameTutorialRect(a: TutorialRect | null, b: TutorialRect | null): boolean {
  return a === b || (!!a && !!b &&
    Math.abs(a.top - b.top) < 0.25 && Math.abs(a.left - b.left) < 0.25 &&
    Math.abs(a.width - b.width) < 0.25 && Math.abs(a.height - b.height) < 0.25);
}

function findVisibleTarget(targetId: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tutorial-id="${targetId}"]`);
  for (const el of candidates) {
    // Responsive nav duplicates and inactive carousel panels must not win.
    if (el.offsetParent !== null && !el.closest('[inert], [aria-hidden="true"]')) return el;
  }
  return null;
}

// Follow moving/late targets at frame cadence instead of three large jumps.
// Only the first acquisition scrolls, explicitly instantly: global CSS
// scroll-behavior must not start several competing smooth scrolls. DOM,
// target-size, viewport and scroll changes remeasure without re-scrolling.
export function watchTutorialTarget(targetId: string, onRect: (rect: TutorialRect | null) => void): () => void {
  let disposed = false;
  let frame = 0;
  let target: HTMLElement | null = null;
  let scrolled = false;
  let previous: TutorialRect | null = null;
  let sampleUntil = performance.now() + 1600;
  const publish = (rect: TutorialRect | null) => {
    if (sameTutorialRect(previous, rect)) return;
    previous = rect;
    onRect(rect);
  };
  const measure = () => {
    frame = 0;
    if (disposed) return;
    const el = findVisibleTarget(targetId);
    if (el !== target) {
      if (target) resizeObserver?.unobserve(target);
      target = el;
      if (target) resizeObserver?.observe(target);
    }
    if (el) {
      if (!scrolled) {
        const bounds = el.getBoundingClientRect();
        if (bounds.top < 16 || bounds.bottom > window.innerHeight - 16) {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        }
        scrolled = true;
      }
      const bounds = el.getBoundingClientRect();
      publish(bounds.width > 0 && bounds.height > 0 ? {
        top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height, bottom: bounds.bottom,
      } : null);
    } else publish(null);
    if (performance.now() < sampleUntil) frame = requestAnimationFrame(measure);
  };
  const schedule = () => {
    if (disposed) return;
    // Includes a route's transform animation and asynchronous layout settling.
    sampleUntil = Math.max(sampleUntil, performance.now() + 400);
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("scroll", schedule, true);
  measure();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("scroll", schedule, true);
  };
}
