import { useRef, useState } from "react";
import type React from "react";
import { ShieldCheck } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { AvatarViewer } from "./AvatarViewer";
import type { GolferProfile } from "../../types";

const SIZE_CLASSES = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

interface AvatarProps {
  golfer: Pick<GolferProfile, "avatarColor" | "avatarInitials" | "verification" | "photoUrl">;
  size?: keyof typeof SIZE_CLASSES;
  showVerified?: boolean;
  /** Tap opens the magnified photo (a profile's own avatar). Long press always does. */
  magnifyOnTap?: boolean;
}

const LONG_PRESS_MS = 420;
const MOVE_SLOP_PX = 10;

// Long press on any avatar photo: a light haptic tap, then the photo
// magnified (AvatarViewer). Many avatars sit inside a button or link, so the
// click that follows the long press is swallowed once, before it reaches them.
function useMagnify(photoUrl: string | undefined, magnifyOnTap: boolean) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function cancel() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }
  function swallowNextClick() {
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    // A long press that ends off the avatar may never produce a click.
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
  }

  if (!photoUrl) return { handlers: {}, viewer: null };
  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        // Events inside the open viewer bubble here through the portal.
        if (open || (e.pointerType === "mouse" && e.button !== 0)) return;
        startRef.current = { x: e.clientX, y: e.clientY };
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light });
          swallowNextClick();
          setOpen(true);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = startRef.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_SLOP_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      ...(magnifyOnTap
        ? {
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              if (!open) setOpen(true);
            },
          }
        : {}),
    },
    viewer: open ? <AvatarViewer photoUrl={photoUrl} onClose={() => setOpen(false)} /> : null,
  };
}

export function Avatar({ golfer, size = "md", showVerified = true, magnifyOnTap = false }: AvatarProps) {
  const badgeSize = size === "xl" ? 22 : size === "lg" ? 18 : size === "md" ? 14 : 11;
  const { handlers, viewer } = useMagnify(golfer.photoUrl, magnifyOnTap);
  return (
    <div className={`relative inline-flex shrink-0 ${magnifyOnTap && golfer.photoUrl ? "cursor-zoom-in" : ""}`} {...handlers}>
      {viewer}
      {golfer.photoUrl ? (
        <img
          src={golfer.photoUrl}
          alt=""
          draggable={false}
          className={`select-none rounded-full object-cover [-webkit-touch-callout:none] ${SIZE_CLASSES[size]}`}
        />
      ) : (
        <div
          className={`flex items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${golfer.avatarColor} ${SIZE_CLASSES[size]}`}
        >
          {golfer.avatarInitials}
        </div>
      )}
      {showVerified && golfer.verification.verifiedGolfer && (
        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-white p-0.5 shadow-sm">
          <ShieldCheck size={badgeSize} className="text-fairway-600" fill="currentColor" fillOpacity={0.15} />
        </span>
      )}
    </div>
  );
}
