import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { lockHoldSelection } from "../../lib/holdSelectionLock";
import { Copy, Reply, Undo2 } from "lucide-react";
import type { MessageAction } from "../../lib/messageLongPress";
import { FOCUS_EXIT_MS, currentPressScale, focusLayout, overhangBelow, type FocusLayout, type Rect } from "../../lib/messageFocus";
import type { QuickReaction } from "../../lib/reactions";

interface MessageActionsMenuProps {
  // The bubble it was opened on (measured and copied on open).
  bubble: HTMLElement;
  // My message: the menu lines up with the bubble's right edge.
  alignRight: boolean;
  // Closed, animating out (lib/useExitPresence.ts): takes no input, gone
  // after FOCUS_EXIT_MS.
  closing: boolean;
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

const SPRING = "cubic-bezier(0.34, 1.36, 0.64, 1)";
const NO_SHADOW = "0 0 0 0 rgba(15, 23, 42, 0), 0 0 0 0 rgba(15, 23, 42, 0)";
const LIFT_SHADOW = "0 14px 34px -10px rgba(15, 23, 42, 0.45), 0 3px 10px rgba(15, 23, 42, 0.12)";

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// WAAPI where available (all supported WebKit/Chromium); otherwise just
// apply the final frame.
function play(el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!el) return null;
  if (typeof (el as HTMLElement).animate === "function") return (el as HTMLElement).animate(frames, { fill: "both", ...options });
  Object.assign((el as HTMLElement).style, frames[frames.length - 1]);
  return null;
}

// The bubble's own box (its CSS size, so the press scale doesn't count)
// centred on where it is drawn, and the scale it's drawn at right now.
function measure(bubble: HTMLElement): { rect: Rect; drawnScale: number; overhang: number } {
  const cs = getComputedStyle(bubble);
  const r = bubble.getBoundingClientRect();
  const width = parseFloat(cs.width) || r.width;
  const height = parseFloat(cs.height) || r.height;
  const drawnScale = currentPressScale(r.width, width);
  return {
    rect: { left: r.left + r.width / 2 - width / 2, top: r.top + r.height / 2 - height / 2, width, height },
    drawnScale,
    // The reaction pill hangs below the box (-bottom-4).
    overhang: overhangBelow(r.bottom, [...bubble.children].map((c) => c.getBoundingClientRect().bottom), r.width / width || 1),
  };
}

// A purely visual copy: no ids/data hooks (so no gesture or test finds it),
// nothing focusable, no inline styles left by the swipe gestures.
function copyOf(bubble: HTMLElement): HTMLElement {
  const copy = bubble.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    for (const name of [...el.getAttributeNames()]) {
      if (name.startsWith("data-") || name === "id" || name.startsWith("aria-") || name === "role") el.removeAttribute(name);
    }
    if (el instanceof HTMLButtonElement || el.tabIndex >= 0) el.tabIndex = -1;
  }
  copy.removeAttribute("style");
  copy.setAttribute("inert", "");
  Object.assign(copy.style, { margin: "0", maxWidth: "none", width: "100%", height: "100%", boxShadow: LIFT_SHADOW });
  return copy;
}

// The popover a long-press / right-click on a DM bubble opens
// (useMessageLongPress), with an Instagram/Telegram-style focus: the screen
// dims and blurs, a copy of the bubble is drawn above it, gently enlarged
// (lib/messageFocus.ts, which also says why a copy and not the real
// bubble), and the quick reactions (popping in, staggered) + Reply / Copy /
// Unsend sit above it (below when there's no room; a bubble that can't fit
// with the menu moves just enough, a very long one stays put). Reduced
// motion: only the dim and the menu, nothing scales or moves.
// Closes on a tap on the dim, Escape, any scroll or resize; closing
// animates back in FOCUS_EXIT_MS while taking no input, and nothing of it
// stays mounted after. Nothing here takes focus (mousedown preventDefault,
// same as the composer's send button), so an open keyboard stays open; the
// thread's scroll position, sizes and the real bubble's layout never change
// (the real bubble is only made transparent while its copy stands in).
export function MessageActionsMenu({ bubble, alignRight, closing, reactions, actions, labels, onReply, onUnsend, onCopy, onClose }: MessageActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const safeTopRef = useRef<HTMLDivElement>(null);
  const safeBottomRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const downOnMenu = useRef(false);
  const animations = useRef<Animation[]>([]);
  const [layout, setLayout] = useState<{ natural: Rect; focus: FocusLayout; from: number; reduced: boolean } | null>(null);

  // Open: measure, copy, hide the real bubble (opacity only: no layout
  // change, and it stays a hit target, so a new hold during the exit works).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const lift = liftRef.current;
    if (!menu || !lift) return;
    const { rect, drawnScale, overhang } = measure(bubble);
    lift.replaceChildren(copyOf(bubble));
    const previousOpacity = bubble.style.opacity;
    bubble.style.opacity = "0";
    const vv = window.visualViewport;
    const safeTop = safeTopRef.current?.offsetHeight ?? 0;
    const safeBottom = safeBottomRef.current?.offsetHeight ?? 0;
    const vTop = vv ? vv.offsetTop : 0;
    const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const vLeft = vv ? vv.offsetLeft : 0;
    const vRight = vv ? vv.offsetLeft + vv.width : window.innerWidth;
    const reduced = prefersReducedMotion();
    const focus = focusLayout({
      bubble: rect,
      overhangBottom: overhang,
      menu: { width: menu.offsetWidth, height: menu.offsetHeight },
      // The status bar / home indicator areas count only where the visible
      // area reaches them.
      viewport: { top: Math.max(vTop, safeTop), bottom: Math.min(vBottom, window.innerHeight - safeBottom), left: vLeft, right: vRight },
      alignRight,
      reducedMotion: reduced,
    });
    setLayout({ natural: rect, focus, from: reduced ? 1 : drawnScale, reduced });
    return () => {
      for (const a of animations.current) a.cancel();
      bubble.style.opacity = previousOpacity;
    };
  }, [bubble, alignRight]);

  // Enter: dim fades in, the copy springs from the pressed scale to the
  // focus scale (and moves, if it had to), the menu pops in, the emojis
  // follow one after another.
  const opened = layout !== null;
  useLayoutEffect(() => {
    if (!layout) return;
    const { focus, from, reduced } = layout;
    const lift = liftRef.current;
    const menu = menuRef.current;
    const list: (Animation | null)[] = [play(backdropRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 150 : 200, easing: "ease-out" })];
    if (!reduced) {
      list.push(
        play(lift, [{ transform: `translate3d(0px, 0px, 0px) scale(${from})` }, { transform: `translate3d(${focus.dx}px, ${focus.dy}px, 0px) scale(${focus.scale})` }], {
          duration: 320,
          easing: SPRING,
        }),
        play(lift?.firstElementChild, [{ boxShadow: NO_SHADOW }, { boxShadow: LIFT_SHADOW }], { duration: 220, easing: "ease-out" }),
        play(
          menu,
          [
            { opacity: 0, transform: `translate3d(0px, ${focus.placement === "above" ? 8 : -8}px, 0px) scale(0.9)` },
            { opacity: 1, transform: "translate3d(0px, 0px, 0px) scale(1)" },
          ],
          { duration: 260, delay: 30, easing: SPRING },
        ),
      );
      menu?.querySelectorAll("[data-emoji-glyph]").forEach((glyph, i) => {
        list.push(
          play(glyph, [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }], { duration: 280, delay: 70 + i * 28, easing: SPRING }),
        );
      });
    }
    animations.current = list.filter((a): a is Animation => a !== null);
    // Only on open; closing has its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  // Close: everything animates back from wherever it is right now. The real
  // bubble may have changed meanwhile (a reaction just added gives it a
  // pill and a bottom margin, and the list can re-pin to the bottom), so
  // the copy is refreshed and aims at where the bubble is now; re-checked
  // two frames later, after the list's own ResizeObserver has run.
  useLayoutEffect(() => {
    if (!closing || !layout) return;
    const lift = liftRef.current;
    const menu = menuRef.current;
    const backdrop = backdropRef.current;
    const started = performance.now();
    let target = layout.natural;
    const aim = (duration: number) => {
      if (!lift) return;
      const drawn = lift.getBoundingClientRect();
      const backdropOpacity = backdrop ? getComputedStyle(backdrop).opacity : "1";
      const menuOpacity = menu ? getComputedStyle(menu).opacity : "1";
      const menuTransform = menu ? getComputedStyle(menu).transform : "none";
      for (const a of animations.current) a.cancel();
      const list: (Animation | null)[] = [];
      if (bubble.isConnected) {
        target = measure(bubble).rect;
        lift.replaceChildren(copyOf(bubble));
        Object.assign(lift.style, { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px` });
      }
      list.push(play(backdrop, [{ opacity: backdropOpacity }, { opacity: 0 }], { duration, easing: "ease-in" }));
      list.push(play(menu, [{ opacity: menuOpacity, transform: menuTransform }, { opacity: 0, transform: menuTransform }], { duration: Math.min(duration, 120), easing: "ease-in" }));
      if (!layout.reduced && target.width > 0) {
        const dx = drawn.left + drawn.width / 2 - (target.left + target.width / 2);
        const dy = drawn.top + drawn.height / 2 - (target.top + target.height / 2);
        const s = drawn.width / target.width;
        list.push(
          play(lift, [{ transform: `translate3d(${dx}px, ${dy}px, 0px) scale(${s})` }, { transform: "translate3d(0px, 0px, 0px) scale(1)" }], {
            duration,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          }),
          play(lift.firstElementChild, [{ boxShadow: LIFT_SHADOW }, { boxShadow: NO_SHADOW }], { duration, easing: "ease-in" }),
        );
      } else {
        list.push(play(lift.firstElementChild, [{ boxShadow: LIFT_SHADOW }, { boxShadow: NO_SHADOW }], { duration, easing: "ease-in" }));
      }
      animations.current = list.filter((a): a is Animation => a !== null);
    };
    aim(FOCUS_EXIT_MS);
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        if (!bubble.isConnected) return;
        const now = measure(bubble).rect;
        if (Math.abs(now.top - target.top) > 0.5 || Math.abs(now.left - target.left) > 0.5) aim(Math.max(60, FOCUS_EXIT_MS - (performance.now() - started)));
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // No page text selection while the overlay is up, and none left behind
  // after it closes (lib/holdSelectionLock).
  useEffect(() => lockHoldSelection(), []);

  useEffect(() => {
    if (closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, closing]);

  const item =
    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:bg-slate-50";
  const natural = layout?.natural;
  const focus = layout?.focus;
  return (
    // Fixed over the whole page while open; no input at all while closing
    // (so the composer and the thread are reachable at once), unmounted
    // after. touch-none: a drag on the dim never pans or zooms the page.
    <div className={`fixed inset-0 z-50 touch-none ${closing ? "pointer-events-none" : ""}`} aria-hidden={closing || undefined}>
      {/* The dim. Closes on a tap that STARTED on it (the finger that
          opened the menu by holding never counts); mousedown
          preventDefault keeps the composer focused. */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-slate-900/25 backdrop-blur-[3px]"
        style={{ opacity: 0 }}
        onPointerDown={() => {
          downOnBackdrop.current = true;
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (downOnBackdrop.current) onClose();
          downOnBackdrop.current = false;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      {/* Safe-area probes (env() is only readable through layout). */}
      <div ref={safeTopRef} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 h-[env(safe-area-inset-top)] w-px" />
      <div ref={safeBottomRef} aria-hidden="true" className="pointer-events-none invisible fixed bottom-0 left-0 h-[env(safe-area-inset-bottom)] w-px" />
      {/* The bubble's copy, at the real bubble's box; transformed about its
          centre. Visual only. */}
      <div
        ref={liftRef}
        aria-hidden="true"
        className="pointer-events-none fixed"
        style={
          natural
            ? { left: natural.left, top: natural.top, width: natural.width, height: natural.height, transformOrigin: "50% 50%", willChange: layout?.reduced ? undefined : "transform" }
            : { left: 0, top: 0, visibility: "hidden" }
        }
      />
      {/* The menu can open under the holding finger (a long bubble, menu
          clamped to the screen edge); lifting that finger may fire a click
          there. Items act only on a click whose press started on the menu
          after it opened (or a keyboard click, detail 0). */}
      <div
        ref={menuRef}
        onPointerDownCapture={() => {
          downOnMenu.current = true;
        }}
        onClickCapture={(e) => {
          if (e.detail !== 0 && !downOnMenu.current) {
            e.preventDefault();
            e.stopPropagation();
          }
          downOnMenu.current = false;
        }}
        role={closing ? undefined : "menu"}
        aria-label={closing ? undefined : labels.menu}
        className={`fixed flex flex-col gap-2 ${alignRight ? "items-end" : "items-start"}`}
        style={
          focus
            ? {
                top: focus.menuTop,
                left: focus.menuLeft,
                transformOrigin: `${alignRight ? "right" : "left"} ${focus.placement === "above" ? "bottom" : "top"}`,
              }
            : { top: 0, left: 0, visibility: "hidden" }
        }
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
                  <span aria-hidden="true" data-emoji-glyph>
                    {emoji}
                  </span>
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
    </div>
  );
}
