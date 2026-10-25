import { useEffect } from "react";
import { createPortal } from "react-dom";

// A golfer's photo magnified into a big circle over a blurred page, like
// Instagram's profile-picture peek. Opened by a tap on a profile's own avatar
// or a long press on any avatar (see Avatar); a tap anywhere closes it.
export function AvatarViewer({ photoUrl, onClose }: { photoUrl: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[95] flex animate-fade-in items-center justify-center bg-slate-900/60 backdrop-blur-xl motion-reduce:animate-none"
    >
      <img
        src={photoUrl}
        alt=""
        draggable={false}
        className="aspect-square w-[min(78vw,22rem)] animate-[avatar-grow_0.28s_cubic-bezier(0.34,1.4,0.64,1)] select-none rounded-full object-cover shadow-2xl shadow-black/40 [-webkit-touch-callout:none] motion-reduce:animate-none"
      />
    </div>,
    document.body,
  );
}
