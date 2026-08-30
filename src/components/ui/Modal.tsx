import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
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
export function Modal({ title, onClose, children, footer }: ModalProps) {
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-slide-up flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl"
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
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
