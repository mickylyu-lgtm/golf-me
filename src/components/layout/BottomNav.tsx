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
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 flex overflow-hidden rounded-full border border-slate-200 bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur-sm sm:hidden"
    >
      {/* Sliding background pill -- follows the drag preview while dragging,
          otherwise glides to whatever the real current route is (e.g. after
          a plain tap, or any programmatic navigation). transform:translateX
          with a percentage is relative to this element's OWN width (already
          1/5 of the bar via the inline width below), so `N * 100%` lands it
          exactly on slot N regardless of the bar's actual pixel width. */}
      <div
        className="pointer-events-none absolute inset-y-1 left-0 rounded-full bg-fairway-50"
        style={{
          width: `${100 / MOBILE_NAV_ITEMS.length}%`,
          transform: `translateX(${indicatorIndex * 100}%)`,
          transition: dragging || reducedMotion ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
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
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors duration-200 ease-out active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-inset motion-reduce:transition-none ${
              isHighlighted ? "text-fairway-700" : "text-slate-400"
            }`}
          >
            {/* Fixed-height wrapper keeps every label starting at the
                same offset regardless of icon size -- Caddie's icon
                renders larger (so its "AI" lettering stays legible)
                but must not push its label out of line with its
                siblings' labels below. */}
            <span className="relative flex h-7 items-center justify-center">
              {isCaddie ? (
                <CaddieNavStatusIcon size={28} strokeWidth={isHighlighted ? 2.5 : 2} />
              ) : (
                <Icon size={22} strokeWidth={isHighlighted ? 2.5 : 2} />
              )}
              {path === "/messages" && unreadCount > 0 && (
                <span
                  className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-fairway-500 px-1 text-[9px] font-bold leading-none text-white"
                  aria-label={`${unreadCount} unread messages`}
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            {t(labelKey)}
          </NavLink>
        );
      })}
    </nav>
  );
}
