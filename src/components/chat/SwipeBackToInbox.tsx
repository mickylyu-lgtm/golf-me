import { useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEdgeSwipeBack } from "../../lib/useEdgeSwipeBack";

// Wraps the DM thread route (/messages/:id) with the iOS-style edge swipe
// back to the Chat list. A wrapper rather than code inside
// DirectMessageThread so that file's frozen keyboard/viewport/composer/
// scroll-anchoring logic stays untouched.
//
// The wrapper bleeds out over AppShell's column padding (-mx, matching px on
// the slider), so a touch in the 16px gutter at the screen edge lands on it
// and the sliding page covers the full width. At rest it adds no styles,
// sizes or stacking contexts the thread can see: the thread's content box is
// exactly where it was.

export function SwipeBackToInbox({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEdgeSwipeBack(wrapperRef, sliderRef, backdropRef, () => {
    // Opened from the inbox (Inbox passes this state): pop back to that
    // same history entry, like the header's back arrow. Otherwise (a push
    // notification, a golfer's profile, a deep link) go to the inbox
    // without leaving the thread behind in history.
    const fromInbox = (location.state as { fromInbox?: boolean } | null)?.fromInbox === true;
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (fromInbox && typeof idx === "number" && idx > 0) navigate(-1);
    else navigate("/messages", { replace: true });
  });

  return (
    <div ref={wrapperRef} className="relative -mx-4 sm:-mx-6">
      <div ref={backdropRef} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-900" style={{ display: "none", opacity: 0 }} />
      <div ref={sliderRef} className="relative px-4 sm:px-6">
        {children}
      </div>
    </div>
  );
}
