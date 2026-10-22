// Opt-in, dev-only performance and gesture HUD for measuring the Home feed on
// a real iPhone without a Mac (2026-10-22, feed lag investigation).
//
// Off unless localStorage.gmPerfHud === "1". Visiting any page with
// ?perfhud=1 turns it on (and ?perfhud=0 turns it off), since the iOS app has
// no console. When off, every export below is a cheap no-op and nothing is
// installed. Plain DOM, no React, so the HUD itself never re-renders the app.
//
// What it counts:
// - Dropped frames: requestAnimationFrame gaps over 34 ms, split into
//   "touch" (finger down, or up to 1 s after it lifts, i.e. momentum) and
//   "idle". Gaps while hidden or while a video is in native fullscreen are
//   ignored (rAF pauses there by design).
// - Click-after-move: a push to a post (/community/:id) during or right after
//   a touch that moved more than 10 px.
// - Double navigation: the same path pushed twice within 600 ms.
// - Double-open: the in-app media viewer opening within 3 s of a native
//   fullscreen begin.
// - Tab swipes that started on post media (photo carousel or media viewer).
// - Feed scroll drift: how far the page moved while the media viewer was
//   open, and how far Back from a post landed from where the feed was left.

const STORAGE_KEY = "gmPerfHud";
const JANK_GAP_MS = 34;
const MOMENTUM_WINDOW_MS = 1000;
const TAP_SLOP_PX = 10;

interface Counters {
  touchFrames: number;
  touchJank: number;
  idleFrames: number;
  idleJank: number;
  worstGapMs: number;
  clickAfterMove: number;
  doubleNav: number;
  postOpens: number;
  doubleOpen: number;
  viewerOpens: number;
  nativeFullscreens: number;
  tabSwipeFromMedia: number;
  tabSwipes: number;
  viewerDriftMaxPx: number;
  backDriftLastPx: number;
  backDriftMaxPx: number;
}

function zero(): Counters {
  return {
    touchFrames: 0,
    touchJank: 0,
    idleFrames: 0,
    idleJank: 0,
    worstGapMs: 0,
    clickAfterMove: 0,
    doubleNav: 0,
    postOpens: 0,
    doubleOpen: 0,
    viewerOpens: 0,
    nativeFullscreens: 0,
    tabSwipeFromMedia: 0,
    tabSwipes: 0,
    viewerDriftMaxPx: 0,
    backDriftLastPx: 0,
    backDriftMaxPx: 0,
  };
}

let enabled = false;
let c: Counters = zero();

function readEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("perfhud");
    if (param === "1") localStorage.setItem(STORAGE_KEY, "1");
    if (param === "0") localStorage.removeItem(STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether a selector-matching ancestor holds post media (carousel/viewer). */
const MEDIA_SELECTOR = "[data-gm-media]";

export function perfHudTabSwipe(startTarget: EventTarget | null) {
  if (!enabled) return;
  c.tabSwipes += 1;
  if (startTarget instanceof Element && startTarget.closest(MEDIA_SELECTOR)) c.tabSwipeFromMedia += 1;
}

let viewerOpenScrollY: number | null = null;
let lastNativeBeginAt = 0;

export function perfHudViewer(open: boolean) {
  if (!enabled) return;
  if (open) {
    c.viewerOpens += 1;
    if (Date.now() - lastNativeBeginAt < 3000) c.doubleOpen += 1;
    viewerOpenScrollY = window.scrollY;
  } else if (viewerOpenScrollY !== null) {
    c.viewerDriftMaxPx = Math.max(c.viewerDriftMaxPx, Math.round(Math.abs(window.scrollY - viewerOpenScrollY)));
    viewerOpenScrollY = null;
  }
}

export function installPerfHud() {
  if (enabled || typeof window === "undefined" || !readEnabled()) return;
  enabled = true;

  // Touch state
  let touchDown = false;
  let lastTouchEndAt = 0;
  let startX = 0;
  let startY = 0;
  let maxMove = 0;
  let nativeFullscreen = false;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener(
    "touchstart",
    (e) => {
      touchDown = true;
      maxMove = 0;
      const t = e.touches[0];
      if (t) {
        startX = t.clientX;
        startY = t.clientY;
      }
    },
    opts,
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) maxMove = Math.max(maxMove, Math.hypot(t.clientX - startX, t.clientY - startY));
    },
    opts,
  );
  const end = () => {
    touchDown = false;
    lastTouchEndAt = performance.now();
  };
  document.addEventListener("touchend", end, opts);
  document.addEventListener("touchcancel", end, opts);
  // Non-bubbling media events still pass through document in the capture phase.
  document.addEventListener(
    "webkitbeginfullscreen",
    () => {
      nativeFullscreen = true;
      lastNativeBeginAt = Date.now();
      c.nativeFullscreens += 1;
    },
    opts,
  );
  document.addEventListener("webkitendfullscreen", () => (nativeFullscreen = false), opts);

  // Frame sampler
  let last = performance.now();
  const frame = (now: number) => {
    const gap = now - last;
    last = now;
    if (!document.hidden && !nativeFullscreen && gap < 1000) {
      const touching = touchDown || now - lastTouchEndAt < MOMENTUM_WINDOW_MS;
      if (touching) {
        c.touchFrames += 1;
        if (gap > JANK_GAP_MS) c.touchJank += 1;
      } else {
        c.idleFrames += 1;
        if (gap > JANK_GAP_MS) c.idleJank += 1;
      }
      if (gap > c.worstGapMs) c.worstGapMs = Math.round(gap);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Navigation observer: wraps pushState so it measures the app as-is,
  // independent of any guard inside the app.
  let lastPushPath = "";
  let lastPushAt = 0;
  let feedScrollY: number | null = null;
  const origPush = history.pushState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    const from = window.location.pathname;
    origPush(data, unused, url);
    const to = window.location.pathname;
    const now = performance.now();
    if (to === lastPushPath && now - lastPushAt < 600) c.doubleNav += 1;
    lastPushPath = to;
    lastPushAt = now;
    if (/^\/community\/(?!new$|guidelines$)[^/]+$/.test(to)) {
      c.postOpens += 1;
      const recentTouch = touchDown || now - lastTouchEndAt < 400;
      if (recentTouch && maxMove > TAP_SLOP_PX) c.clickAfterMove += 1;
      if (from === "/") feedScrollY = window.scrollY;
    }
  };
  window.addEventListener("popstate", () => {
    if (window.location.pathname !== "/" || feedScrollY === null) return;
    const expected = feedScrollY;
    feedScrollY = null;
    window.setTimeout(() => {
      const drift = Math.round(Math.abs(window.scrollY - expected));
      c.backDriftLastPx = drift;
      c.backDriftMaxPx = Math.max(c.backDriftMaxPx, drift);
    }, 800);
  });

  // Overlay
  const box = document.createElement("div");
  box.setAttribute("data-perf-hud", "");
  box.style.cssText =
    "position:fixed;left:6px;top:calc(env(safe-area-inset-top) + 6px);z-index:2147483647;max-width:230px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.78);color:#fff;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:auto";
  const text = document.createElement("div");
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;margin-top:4px";
  const mkBtn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:2px 6px;border-radius:5px;background:#fff;color:#000;font:inherit";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    row.appendChild(b);
  };
  let collapsed = false;
  mkBtn("Reset", () => {
    c = zero();
    render();
  });
  mkBtn("Copy", () => {
    void navigator.clipboard?.writeText(summary()).catch(() => {});
  });
  mkBtn("Min", () => {
    collapsed = !collapsed;
    render();
  });
  box.append(text, row);

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
  function summary(): string {
    return [
      `drops touch ${c.touchJank}/${c.touchFrames} (${pct(c.touchJank, c.touchFrames)})`,
      `drops idle  ${c.idleJank}/${c.idleFrames} (${pct(c.idleJank, c.idleFrames)})`,
      `worst gap   ${c.worstGapMs} ms`,
      `post opens  ${c.postOpens}`,
      `click>move  ${c.clickAfterMove}`,
      `double nav  ${c.doubleNav}`,
      `native fs   ${c.nativeFullscreens}`,
      `viewer open ${c.viewerOpens} (double ${c.doubleOpen})`,
      `viewer drift max ${c.viewerDriftMaxPx}px`,
      `tab swipes  ${c.tabSwipes} (from media ${c.tabSwipeFromMedia})`,
      `back drift  ${c.backDriftLastPx}px (max ${c.backDriftMaxPx})`,
    ].join("\n");
  }
  function render() {
    text.textContent = collapsed
      ? `drops ${pct(c.touchJank, c.touchFrames)} | nav err ${c.clickAfterMove + c.doubleNav + c.doubleOpen}`
      : summary();
  }
  const mount = () => document.body.appendChild(box);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
  render();
  window.setInterval(render, 500);
}
