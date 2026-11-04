import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Undo2 } from "lucide-react";
import { placeActionsMenu } from "../../lib/messageLongPress";

interface MessageActionsMenuProps {
  // The bubble it was opened on (re-measured on open).
  bubble: HTMLElement;
  // My message: the menu lines up with the bubble's right edge.
  alignRight: boolean;
  labels: { menu: string; unsend: string; copy: string };
  onUnsend: () => void;
  onCopy: () => void;
  onClose: () => void;
}

// The small popover a long-press / right-click on one of my DM bubbles
// opens (useMessageLongPress): Unsend, plus Copy because those bubbles
// turn off iOS's own text-selection callout. Fixed-positioned above the
// bubble (below it near the top of the screen). Closes on a tap/click
// outside, Escape, any scroll or resize. Its buttons don't take focus
// (mousedown preventDefault, same as the composer's send button), so an
// open keyboard stays open.
export function MessageActionsMenu({ bubble, alignRight, labels, onUnsend, onCopy, onClose }: MessageActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = bubble.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewportTop = vv ? vv.offsetTop : 0;
    const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const { top } = placeActionsMenu({ anchorTop: rect.top, anchorBottom: rect.bottom, menuHeight: menu.offsetHeight, viewportTop, viewportBottom });
    const width = menu.offsetWidth;
    const rawLeft = alignRight ? rect.right - width : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
    setPos({ top, left });
  }, [bubble, alignRight]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Opened by a long-press: that same finger's pointerup/click must not
    // count as "outside", so outside-taps are listened for from the next
    // task on.
    const t = window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown, true), 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const item =
    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:bg-slate-50";
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={labels.menu}
      className="fixed z-50 min-w-40 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onCopy} className={`${item} text-slate-700 hover:bg-slate-50`}>
        <Copy size={15} aria-hidden="true" /> {labels.copy}
      </button>
      <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onUnsend} className={`${item} text-red-600 hover:bg-red-50`}>
        <Undo2 size={15} aria-hidden="true" /> {labels.unsend}
      </button>
    </div>
  );
}
