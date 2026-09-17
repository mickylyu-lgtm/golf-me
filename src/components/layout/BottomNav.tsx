import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { MOBILE_NAV_ITEMS } from "../../lib/nav";
import { NAV_TUTORIAL_ID_BY_PATH } from "../../lib/tutorialSteps";
import { useLocale } from "../../i18n/LocaleContext";
import { useData } from "../../context/DataContext";
import { useCaddieNavStatus } from "../../lib/useCaddieNavStatus";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import { CaddieNavStatusIcon } from "./CaddieNavStatusIcon";

// Below this, a touch hasn't moved enough to tell a tap from the start of a
// drag yet -- deliberately no direction-ratio check like RootTabCarousel's
// (that one exists specifically to disambiguate a horizontal swipe from
// vertical PAGE scroll; this bar isn't a scrollable container, so any
// movement past the deadzone unambiguously means "drag across the tabs").
const DRAG_DEADZONE_PX = 10;

// Always expanded at/near the very top of the page, regardless of the last
// scroll direction -- matches "if the user is very close to the top, prefer
// EXPANDED."
const NEAR_TOP_PX = 16;
// Cumulative downward movement (since the last direction change) needed to
// collapse -- within the doc's 50-80px range. Deliberately larger than the
// expand threshold below: collapsing should take a clear, deliberate scroll,
// while re-expanding (getting labels back) should feel more forgiving.
const COLLAPSE_THRESHOLD_PX = 64;
const EXPAND_THRESHOLD_PX = 24;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function BottomNav() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { dmConversations, markNotificationRead } = useData();
  const unreadCount = dmConversations.filter((c) => c.unread).length;
  const { isProcessing: caddieProcessing, unseenNotification: caddieUnseen } = useCaddieNavStatus();
  // `fixed bottom-0` is anchored against the LAYOUT viewport, which
  // resize:"body" doesn't actually change (see useKeyboardHeight's own
  // comment) -- so without hiding it, BottomNav would sit behind/under the
  // keyboard, not above it. Hiding it here is what makes a focused
  // composer/textarea anywhere in the app read as the keyboard's own
  // bottom edge, iMessage/Instagram style, instead of a stray tab bar
  // showing through or competing for space. Untouched by the floating/
  // drag-select redesign below -- still the first thing checked, still a
  // plain early return.
  const keyboardOpen = useKeyboardHeight() > 0;

  // Mirrors each NavLink's own `end={path === "/"}` matching (Home matches
  // only the exact root path; every other tab matches any nested route
  // under it) -- needed as a plain index because the drag-preview indicator
  // has to compare against "the real current tab" independent of any one
  // NavLink's own isActive render-prop.
  const activeIndex = useMemo(() => {
    const idx = MOBILE_NAV_ITEMS.findIndex((item) => (item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path)));
    return idx === -1 ? 0 : idx;
  }, [location.pathname]);
  // Read inside the touch-event closure below (registered once, not
  // per-render) so it always sees the latest real route without the effect
  // needing activeIndex in its own dependency array -- re-attaching native
  // touch listeners on every route change (or worse, on every preview
  // update mid-drag) would be wasteful and risks dropping an in-progress
  // gesture's events.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  // Same reasoning as activeIndexRef -- read fresh inside the touch-event
  // closure (registered once) without needing either in that effect's deps.
  const caddieUnseenRef = useRef(caddieUnseen);
  caddieUnseenRef.current = caddieUnseen;
  const markNotificationReadRef = useRef(markNotificationRead);
  markNotificationReadRef.current = markNotificationRead;

  const navRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<{ startX: number; startY: number; dragging: boolean; lastHapticIndex: number | null } | null>(null);
  // null = no active drag preview (indicator follows the real route).
  // Set only once a touch has moved past the deadzone; a plain tap never
  // touches this at all, so normal single-tap navigation is untouched --
  // it's still just the browser's own click reaching the NavLink's own
  // onClick, nothing here ever calls preventDefault or navigate() for it.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Scroll-aware collapse. Listens on `window`, not a dedicated container --
  // confirmed live (no overflow rule anywhere between html/body/#root and
  // AppShell) that Home/Chat-list/Play/Caddie/Me all genuinely scroll at
  // the plain window level; only DirectMessageThread locks body scroll to
  // scroll its own internal message list instead, so this listener simply
  // never fires there -- the nav just stays in whatever state it was last
  // in on that screen, which is the "preserve existing behavior" outcome
  // for chat threads without any special-casing.
  const [collapsed, setCollapsed] = useState(false);
  const lastScrollYRef = useRef(0);
  // Cumulative movement since the last direction reversal -- positive while
  // scrolling down, negative while scrolling up. This (not raw per-pixel
  // deltas) is what gives the hysteresis: a few pixels of wobble in the
  // "wrong" direction never crosses either threshold on its own.
  const scrollAccumRef = useRef(0);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;
    let ticking = false;

    function handleScroll() {
      // rAF-throttled: at most one state check per animation frame no
      // matter how many scroll events fire in a burst -- this is the "no
      // high-frequency React state updates for every scroll pixel"
      // requirement. setCollapsed itself only actually re-renders on the
      // (rare) frames where the discrete state truly flips, since React
      // bails out a set to the same boolean value.
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const delta = y - lastScrollYRef.current;
        lastScrollYRef.current = y;

        if (y <= NEAR_TOP_PX) {
          scrollAccumRef.current = 0;
          setCollapsed(false);
          return;
        }
        if (delta === 0) return;
        if (Math.sign(delta) !== Math.sign(scrollAccumRef.current)) scrollAccumRef.current = 0;
        scrollAccumRef.current += delta;

        if (scrollAccumRef.current >= COLLAPSE_THRESHOLD_PX) {
          scrollAccumRef.current = 0;
          setCollapsed(true);
        } else if (scrollAccumRef.current <= -EXPAND_THRESHOLD_PX) {
          scrollAccumRef.current = 0;
          setCollapsed(false);
        }
      });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // "page opens -> EXPANDED" + "reset state appropriately when changing
  // tabs/routes" -- a fresh screen always starts expanded regardless of
  // where the previous one left off.
  useEffect(() => {
    setCollapsed(false);
    scrollAccumRef.current = 0;
    lastScrollYRef.current = window.scrollY;
  }, [location.pathname]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    function indexFromClientX(clientX: number): number {
      const rect = el!.getBoundingClientRect();
      const tabWidth = rect.width / MOBILE_NAV_ITEMS.length;
      const relativeX = clientX - rect.left;
      return Math.min(MOBILE_NAV_ITEMS.length - 1, Math.max(0, Math.floor(relativeX / tabWidth)));
    }

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, dragging: false, lastHapticIndex: null };
      // Deliberately NOT expanding on touch anymore (an earlier pass did).
      // indexFromClientX re-measures getBoundingClientRect() live on every
      // touchmove, so it always reflects the nav's CURRENT width -- fine
      // normally, but this pass adds a width change between states (not
      // just padding/label height before), and expanding right as a drag
      // starts would mean measuring mid-CSS-transition on some frames,
      // which can shift the computed tab index under the finger with no
      // finger movement at all. Per spec ("if expanding on touch makes
      // drag math unstable, keep it collapsed until gesture completion and
      // expand afterward, choose the technically stable behavior"): the
      // nav simply stays in whatever state it was already in for the
      // entire gesture, and only re-evaluates via the normal scroll/route
      // logic afterward.
    }

    function onTouchMove(e: TouchEvent) {
      const state = gestureRef.current;
      if (!state) return;
      const touch = e.touches[0];
      if (!state.dragging) {
        if (Math.abs(touch.clientX - state.startX) < DRAG_DEADZONE_PX && Math.abs(touch.clientY - state.startY) < DRAG_DEADZONE_PX) return;
        state.dragging = true;
        // The tab the drag actually started on doesn't itself buzz --
        // only crossing INTO a different one does (see below).
        state.lastHapticIndex = indexFromClientX(state.startX);
      }
      // Only claimed once actually decided as a drag -- a plain tap's
      // touchmove (if it fires at all) never reaches here, so it never
      // interferes with the browser's own default tap handling.
      e.preventDefault();
      const index = indexFromClientX(touch.clientX);
      setPreviewIndex(index);
      if (index !== state.lastHapticIndex) {
        state.lastHapticIndex = index;
        // Fire-and-forget, native-only -- Haptics has no web implementation
        // and this must never block or fail the actual selection tracking.
        if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light });
      }
    }

    // Navigates ONCE, only for an actual drag that ended on a different
    // tab than the real current one -- reads the functional-update form's
    // `current` value rather than the `previewIndex` variable directly, so
    // this doesn't need previewIndex in the effect's own deps (which would
    // otherwise re-attach these listeners on every preview update mid-drag).
    function commit() {
      const state = gestureRef.current;
      gestureRef.current = null;
      setPreviewIndex((current) => {
        if (state?.dragging && current !== null && current !== activeIndexRef.current) {
          const target = MOBILE_NAV_ITEMS[current];
          // Same shortcut as a normal tap landing on Caddie (see the
          // NavLink's own onClick below) -- which destination you reach
          // shouldn't depend on whether you tapped or drag-released there.
          const unseen = target.path === "/caddie" ? caddieUnseenRef.current : undefined;
          if (unseen) {
            markNotificationReadRef.current(unseen.id);
            navigate(unseen.linkTo);
          } else {
            navigate(target.path);
          }
        }
        return null;
      });
    }

    // Gesture cancelled (e.g. an incoming call/notification interrupts the
    // touch) -- restore the real current tab, never navigate.
    function cancel() {
      gestureRef.current = null;
      setPreviewIndex(null);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", commit, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", commit);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [navigate]);

  if (keyboardOpen) return null;

  const indicatorIndex = previewIndex ?? activeIndex;
  const dragging = previewIndex !== null;
  const reducedMotion = prefersReducedMotion();

  return (
    <nav
      ref={navRef}
      // The new press-and-hold-to-drag interaction means a stationary
      // press on a tab (before any movement) now lingers long enough to
      // trigger WKWebView's own native long-press-on-a-link system menu
      // (NavLink renders an <a href>) -- "Open Link / Copy Link / Share",
      // reported live as making the app read as a website. -webkit-touch-
      // callout inherits to every descendant <a>, so this one property on
      // the container suppresses it everywhere in the bar without touching
      // each NavLink individually. select-none for the same "feels native,
      // not a webpage" reason -- nothing in a tab bar should ever become
      // text-selected by a long press.
      // Switched from inset-x-4 (fixed 16px side margins) to left-1/2 +
      // -translate-x-1/2 + an explicit width, so the bar can also narrow
      // ~20% when collapsed while staying centered -- inset-x-4 alone
      // can't animate a width change since it doesn't express one. Both
      // width values are computed against the viewport (this element is
      // `fixed`, so % in an arbitrary-value width resolves against the
      // initial containing block, same effective width inset-x-4 used to
      // give). Percentage-based math elsewhere (the indicator's `left`,
      // and indexFromClientX's live getBoundingClientRect() reads) both
      // already adapt automatically to whatever the nav's current width
      // is -- neither needed a change for this.
      className={`fixed bottom-[calc(env(safe-area-inset-bottom)+8px)] left-1/2 z-40 flex -translate-x-1/2 select-none overflow-hidden rounded-full border border-slate-200 bg-white/95 backdrop-blur-sm transition-[width,box-shadow] duration-200 ease-out [-webkit-touch-callout:none] motion-reduce:transition-none sm:hidden ${
        collapsed ? "w-[calc(80%-2rem)] shadow-none" : "w-[calc(100%-2rem)] shadow-sm shadow-slate-900/[0.03]"
      }`}
    >
      {/* Compact capsule, sized to the tab CONTENT, not the bar. `left` is a
          percentage to the CENTER of slot N (indicatorIndex + 0.5 slots
          in); translateX(-50%) centers this fixed-width box on that point
          regardless of the bar's actual pixel width -- only `left` itself
          animates for the horizontal glide.

          ROOT CAUSE of "sits too high, only covers the icon" (found on
          review): height used to be a fixed h-8 centered on the WHOLE bar
          via top-1/2/-translate-y-1/2, independent of where the label
          actually rendered -- so it always covered the same fixed region
          around the icon no matter how tall the bar's real content was,
          and never reached the label at all. inset-y-1 replaces that: top
          and bottom are pinned a fixed 4px from the BAR's own edges, so
          the browser computes this element's height as
          (bar height - 8px) on every layout pass, continuously -- as the
          bar's own height smoothly animates between collapsed/expanded
          (via its children's transitioning padding/max-height, see
          below), this height rides along automatically, no separate
          state or transition needed on the indicator itself. In collapsed
          state the bar is already just icon-height + a little padding (no
          label rendered at all), so this naturally becomes "icon-only,
          vertically centered" for free -- not a special case. */}
      <div
        className="pointer-events-none absolute inset-y-1 w-11 rounded-full bg-fairway-50"
        style={{
          left: `${(indicatorIndex + 0.5) * (100 / MOBILE_NAV_ITEMS.length)}%`,
          transform: "translateX(-50%)",
          transition: dragging || reducedMotion ? "none" : "left 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        aria-hidden="true"
      />
      {MOBILE_NAV_ITEMS.map(({ labelKey, path, icon: Icon }, i) => {
        const isCaddie = path === "/caddie";
        const caddieAriaLabel = isCaddie
          ? caddieProcessing
            ? t("caddie.navAnalyzing")
            : caddieUnseen
              ? t("caddie.navResultReady")
              : undefined
          : undefined;
        // Text emphasis follows the drag preview (indicatorIndex), not
        // NavLink's own isActive -- that render-prop only knows the real
        // route, but "which tab will be selected if the finger lifts now"
        // is exactly what this needs to communicate while dragging.
        const isHighlighted = i === indicatorIndex;
        return (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            data-tutorial-id={NAV_TUTORIAL_ID_BY_PATH[path]}
            aria-label={caddieAriaLabel}
            onClick={(e) => {
              // Same shortcut a drag-release onto Caddie also applies (see
              // commit() above) -- kept in both places rather than only
              // here, since this handler covers the plain-tap path and
              // commit() covers the drag-release path; a plain tap never
              // reaches commit() at all.
              if (isCaddie && caddieUnseen) {
                e.preventDefault();
                markNotificationRead(caddieUnseen.id);
                navigate(caddieUnseen.linkTo);
              }
            }}
            className={`relative flex flex-1 flex-col items-center text-[10px] font-medium transition-[padding,color] duration-200 ease-out active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-inset motion-reduce:transition-none ${
              collapsed ? "py-0.5" : "py-1.5"
            } ${isHighlighted ? "text-fairway-700" : "text-slate-400"}`}
          >
            {/* Fixed-height wrapper keeps every label starting at the
                same offset regardless of icon size -- Caddie's icon
                renders larger (so its "AI" lettering stays legible)
                but must not push its label out of line with its
                siblings' labels below. Icons shrink a further, modest
                step in the collapsed state (comfortably, not
                aggressively -- per spec) on top of the padding/label
                changes, so the two states read as clearly, substantially
                different rather than a subtle nudge; Caddie stays
                proportionally larger than the other four in both states
                so its identity still reads. */}
            <span className={`relative flex items-center justify-center transition-[height] duration-200 ease-out motion-reduce:transition-none ${collapsed ? "h-5" : "h-6"}`}>
              {isCaddie ? (
                <CaddieNavStatusIcon size={collapsed ? 21 : 24} strokeWidth={isHighlighted ? 2.5 : 2} />
              ) : (
                <Icon size={collapsed ? 17 : 19} strokeWidth={isHighlighted ? 2.5 : 2} />
              )}
              {/* Sized/positioned to fit within the <nav>'s own
                  overflow-hidden bounds even in the collapsed state (only
                  ~2px of padding above the icon there, vs ~6px expanded) --
                  the previous h-4/-top-1 needed more headroom than the
                  collapsed state actually has, clipping the badge's top
                  edge (reported live, screenshot showed the collapsed nav).
                  Smaller + pulled in closer fits comfortably in both. */}
              {path === "/messages" && unreadCount > 0 && (
                <span
                  className="absolute -right-1 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-fairway-500 px-1 text-[8px] font-bold leading-none text-white"
                  aria-label={`${unreadCount} unread messages`}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            {/* Collapses via max-height + opacity (not display:none/height:
                auto, neither of which can transition smoothly) -- fades out
                and the bar's own height shrinks as a natural side effect of
                this shrinking, no explicit height animation needed on the
                <nav> itself.

                ROOT CAUSE of the previous pass's barely-visible collapse,
                found on review (not just reasserting the same fix): this
                span had no explicit line-height, so text-[10px] inherited
                the ambient ~1.5 default (~15px tall) while max-h-3 (12px)
                capped it below that -- the label was almost certainly
                already clipped even in the "expanded" state, shrinking the
                real visual delta between states to just the ~4px padding
                change, nowhere near "obvious." leading-none pins the
                actual text height to the font size (10px), and max-h-3.5
                (14px) now gives it real headroom instead of sitting right
                at the clipping boundary. */}
            <span
              className={`overflow-hidden text-center leading-none transition-[max-height,opacity,margin-top] duration-200 ease-out motion-reduce:transition-none ${
                collapsed ? "mt-0 max-h-0 opacity-0" : "mt-1 max-h-3.5 opacity-100"
              }`}
            >
              {t(labelKey)}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
