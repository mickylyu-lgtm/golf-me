import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Reply, Undo2 } from "lucide-react";
import { placeActionsMenu, type MessageAction } from "../../lib/messageLongPress";
import type { QuickReaction } from "../../lib/reactions";

interface MessageActionsMenuProps {
  // The bubble it was opened on (re-measured on open).
  bubble: HTMLElement;
  // My message: the menu lines up with the bubble's right edge.
  alignRight: boolean;
  // Quick-reaction row (Instagram-style), or null when reactions aren't
  // available here (blocked, still sending, database not migrated yet).
  reactions: { emojis: readonly QuickReaction[]; mine: QuickReaction | null; onPick: (emoji: QuickReaction) => void } | null;
  actions: MessageAction[];
  labels: { menu: string; reply: string; unsend: string; copy: string; reactWith: (emoji: string) => string };
  onReply: () => void;
  onUnsend: () => void;
  onCopy: () => void;
  onClose: () => void;
}

// The popover a long-press / right-click on a DM bubble opens
// (useMessageLongPress): a row of quick reactions, then Reply, Copy (the
// bubbles turn off iOS's own text-selection callout on touch screens) and,
// for my own message inside 5 minutes, Unsend. Fixed-positioned above the
// bubble (below it near the top of the screen). Closes on a tap/click
// outside, Escape, any scroll or resize. Its buttons don't take focus
// (mousedown preventDefault, same as the composer's send button), so an
// open keyboard stays open.
export function MessageActionsMenu({ bubble, alignRight, reactions, actions, labels, onReply, onUnsend, onCopy, onClose }: MessageActionsMenuProps) {
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
      className={`fixed z-50 flex flex-col gap-2 ${alignRight ? "items-end" : "items-start"}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {reactions && (
        <div className="flex items-center gap-0.5 rounded-full border border-slate-100 bg-white px-1.5 py-1 shadow-lg">
          {reactions.emojis.map((emoji) => {
            const picked = reactions.mine === emoji;
            return (
              <button
                key={emoji}
                type="button"
                role="menuitemradio"
                aria-checked={picked}
                aria-label={labels.reactWith(emoji)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => reactions.onPick(emoji)}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[1.45rem] leading-none transition-transform duration-150 select-none hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 motion-reduce:transition-none motion-reduce:hover:scale-100 ${
                  picked ? "bg-fairway-100" : ""
                }`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="min-w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
        {actions.includes("reply") && (
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onReply} className={`${item} text-slate-700 hover:bg-slate-50`}>
            <Reply size={15} aria-hidden="true" /> {labels.reply}
          </button>
        )}
        {actions.includes("copy") && (
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onCopy} className={`${item} text-slate-700 hover:bg-slate-50`}>
            <Copy size={15} aria-hidden="true" /> {labels.copy}
          </button>
        )}
        {actions.includes("unsend") && (
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onUnsend} className={`${item} text-red-600 hover:bg-red-50`}>
            <Undo2 size={15} aria-hidden="true" /> {labels.unsend}
          </button>
        )}
      </div>
    </div>
  );
}
