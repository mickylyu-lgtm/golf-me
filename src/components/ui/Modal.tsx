import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // Opt-in only (default false = exactly the original behavior). For
  // sheets with text fields: keeps the sheet sitting right on top of the
  // iOS keyboard instead of letting iOS drag the whole screen up to reveal
  // the focused field. See KeyboardAwareModal below.
  keyboardAware?: boolean;
}

// Shared by every modal/popover-style surface in the app (dialogs, panels,
// confirms) — closing on backdrop click and Escape is fixed once here
// rather than per-usage, so it's never accidentally missing somewhere.
//
// Portaled straight to document.body rather than rendering in place: any
// ancestor with its own positioning context (position: sticky/relative/
// transform, or a backdrop-filter) can hijack this div's `fixed inset-0`
// so it positions against that ancestor instead of the real viewport,
// clipping/shrinking the sheet. Confirmed live on iOS Safari specifically
// for NotificationsPanel (nested inside TopBar's `position: sticky`
// header) — the sheet rendered squeezed into header's own box instead of
// the full screen, showing only its first couple rows ("shows half when I
// click the inbox"). A desktop-Chrome-at-mobile-width test didn't
// reproduce it, so don't trust that as sufficient coverage for this class
// of bug. Portaling sidesteps the whole ancestor-positioning question
// permanently, for every caller, not just this one.
export function Modal({ keyboardAware = false, ...props }: ModalProps) {
  // Separate component (not a conditional hook) so the default path never
  // even subscribes to keyboard events -- every existing caller, including
  // the chat screen's ConfirmDialog, renders exactly as before.
  return keyboardAware ? <KeyboardAwareModal {...props} /> : <ModalFrame {...props} />;
}

interface ModalFrameProps extends Omit<ModalProps, "keyboardAware"> {
  overlayStyle?: CSSProperties;
  sheetStyle?: CSSProperties;
  scrollerRef?: RefObject<HTMLDivElement | null>;
}

function ModalFrame({ title, onClose, children, footer, overlayStyle, sheetStyle, scrollerRef }: ModalFrameProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-slide-up flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl"
        style={sheetStyle}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-slate-400 transition-all duration-200 ease-out hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            <X size={18} />
          </button>
        </div>
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// Gap kept between the focused field / sheet top and the screen edges.
const KEYBOARD_GAP_PX = 12;

// Scrolls only `scroller` (never the window) so the focused element inside
// it sits at least KEYBOARD_GAP_PX inside its visible edges.
function revealFocusedField(scroller: HTMLElement) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scroller.contains(active)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const fieldRect = active.getBoundingClientRect();
  const overflowBelow = fieldRect.bottom - (scrollerRect.bottom - KEYBOARD_GAP_PX);
  const overflowAbove = scrollerRect.top + KEYBOARD_GAP_PX - fieldRect.top;
  if (overflowBelow > 0) scroller.scrollTop += overflowBelow;
  else if (overflowAbove > 0) scroller.scrollTop -= overflowAbove;
}

// With capacitor.config.ts's Keyboard resize:"body", the plugin only sets
// document.body.style.height -- the WKWebView frame, 100dvh,
// window.innerHeight and position:fixed all stay full-screen height, so a
// bottom-anchored sheet ends up under the keyboard and iOS pans the whole
// screen to reveal the focused field. Instead, using the plugin's real
// keyboardHeight (same signal DirectMessageThread relies on, verified on
// device): the full-screen backdrop stays put, the sheet is lifted to sit
// exactly on top of the keyboard and shrunk to the space left, and only
// the sheet's own scroller moves to keep the focused field visible. The
// window itself is never scrolled. keyboardHeight is always 0 off-native
// (web/PWA), so there this is identical to the default path apart from
// the page behind being scroll-locked while the sheet is open.
function KeyboardAwareModal(props: Omit<ModalProps, "keyboardAware">) {
  const keyboardHeight = useKeyboardHeight();
  const scrollerRef = useRef<HTMLDivElement>(null);

  // The page behind never scrolls while the sheet is open (same technique
  // as DirectMessageThread). Previous value restored on close.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Scroller position from just before the keyboard opened, restored when
  // it closes. Deliberately the PRE-keyboard position even if the golfer
  // scrolled the sheet while typing: the goal is "closing the keyboard
  // puts the sheet back exactly as it was".
  const scrollTopBeforeKeyboardRef = useRef<number | null>(null);
  const previousKeyboardHeightRef = useRef(0);

  // Keyboard open / close. Runs after the sheet has been resized for the
  // new keyboard height. Only ever touches the sheet's own scroller -- no
  // scrollIntoView (that would also scroll the window), no window scroll.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const previous = previousKeyboardHeightRef.current;
    previousKeyboardHeightRef.current = keyboardHeight;
    if (!scroller) return;

    if (keyboardHeight > 0) {
      if (previous === 0) scrollTopBeforeKeyboardRef.current = scroller.scrollTop;
      const frame = requestAnimationFrame(() => revealFocusedField(scroller));
      return () => cancelAnimationFrame(frame);
    }

    if (previous > 0 && scrollTopBeforeKeyboardRef.current !== null) {
      scroller.scrollTop = scrollTopBeforeKeyboardRef.current;
      scrollTopBeforeKeyboardRef.current = null;
    }
  }, [keyboardHeight]);

  // Switching fields while the keyboard is already open (e.g. Coach
  // Review's four textareas) doesn't change keyboardHeight, so reveal the
  // newly focused field on focus too.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || keyboardHeight <= 0) return;
    let frame = 0;
    const onFocusIn = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => revealFocusedField(scroller));
    };
    scroller.addEventListener("focusin", onFocusIn);
    return () => {
      scroller.removeEventListener("focusin", onFocusIn);
      cancelAnimationFrame(frame);
    };
  }, [keyboardHeight]);

  const keyboardOpen = keyboardHeight > 0;
  return (
    <ModalFrame
      {...props}
      scrollerRef={scrollerRef}
      overlayStyle={keyboardOpen ? { paddingBottom: `${keyboardHeight}px` } : undefined}
      sheetStyle={
        keyboardOpen
          ? {
              maxHeight: `min(88dvh, calc(${window.innerHeight - keyboardHeight}px - env(safe-area-inset-top) - ${KEYBOARD_GAP_PX}px))`,
            }
          : undefined
      }
    />
  );
}
