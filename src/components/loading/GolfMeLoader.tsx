import { useEffect, useState } from "react";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// One golf cart drawing, reused at every size via an outer <g transform="scale()">
// rather than redrawn per context — native box is 44 wide x 30 tall.
function CartGlyph({ animated }: { animated: boolean }) {
  return (
    <g>
      {animated && (
        <>
          <circle className="animate-dust-puff" cx="4" cy="24" r="2.2" fill="#b8d9c1" style={{ animationDelay: "0s" }} />
          <circle className="animate-dust-puff" cx="2" cy="21" r="1.6" fill="#dcece0" style={{ animationDelay: "0.5s" }} />
        </>
      )}
      {/* bag + clubs, trailing at the back */}
      <line x1="3" y1="13" x2="1.5" y2="5" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
      <line x1="5.5" y1="13" x2="6.5" y2="4.5" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
      <rect x="2" y="12.5" width="5.5" height="9.5" rx="1.6" fill="#f2b82c" />
      {/* wheels */}
      <circle cx="12" cy="25" r="4" fill="#475569" className={animated ? "animate-wheel-spin" : ""} style={{ transformOrigin: "12px 25px" }} />
      <circle cx="32" cy="25" r="4" fill="#475569" className={animated ? "animate-wheel-spin" : ""} style={{ transformOrigin: "32px 25px" }} />
      <circle cx="12" cy="25" r="1.4" fill="#cbd5e1" />
      <circle cx="32" cy="25" r="1.4" fill="#cbd5e1" />
      {/* body */}
      <rect x="7" y="14" width="28" height="10" rx="3" fill="#26663d" />
      <circle cx="36" cy="20" r="1.2" fill="#f6cc54" />
      {/* roof + pillars */}
      <line x1="11" y1="14" x2="11" y2="9" stroke="#1e5232" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="29" y1="14" x2="29" y2="9" stroke="#1e5232" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="9" y="6" width="22" height="4" rx="2" fill="#f8faf8" stroke="#e2e8f0" strokeWidth="0.5" />
      {/* simple neutral driver silhouette — cart stays the main character */}
      <rect x="17" y="10.5" width="6" height="4.5" rx="2" fill="#94a3b8" />
      <circle cx="20" cy="9.5" r="2.4" fill="#94a3b8" />
    </g>
  );
}

function CourseScene({ animated }: { animated: boolean }) {
  return (
    <svg viewBox="0 0 300 130" className="w-full max-w-xs" role="presentation" aria-hidden="true">
      <rect width="300" height="92" fill="#f1f8f2" />
      <ellipse cx="45" cy="96" rx="85" ry="34" fill="#dcece0" opacity="0.8" />
      <ellipse cx="235" cy="102" rx="100" ry="30" fill="#dcece0" opacity="0.6" />

      {[[36, 70], [66, 76], [252, 68]].map(([cx, cy], i) => (
        <g key={i}>
          <rect x={cx - 1.5} y={cy + 6} width="3" height="9" fill="#1e5232" />
          <circle cx={cx} cy={cy} r="8" fill="#5aa171" />
        </g>
      ))}

      <rect x="0" y="90" width="300" height="40" fill="#8bc09a" />
      <line x1="18" y1="108" x2="252" y2="108" stroke="#5aa171" strokeWidth="2" strokeDasharray="1 8" strokeLinecap="round" opacity="0.7" />

      {/* destination flag */}
      <ellipse cx="268" cy="109" rx="15" ry="4" fill="#37814f" opacity="0.5" />
      <line x1="272" y1="70" x2="272" y2="108" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
      <path d="M272 70 L285 75.5 L272 81 Z" fill="#f2b82c" />

      <g transform="translate(18, 80)" style={animated ? ({ "--gm-travel": "210px" } as React.CSSProperties) : undefined}>
        <g className={animated ? "animate-cart-drive" : ""}>
          <g className={animated ? "animate-cart-bounce" : ""}>
            <CartGlyph animated={animated} />
          </g>
        </g>
      </g>
    </svg>
  );
}

function InlineCart({ animated, px }: { animated: boolean; px: number }) {
  return (
    <svg viewBox="0 0 70 30" width={px} height={(px * 30) / 70} role="presentation" aria-hidden="true">
      <line x1="4" y1="26" x2="64" y2="26" stroke="#dcece0" strokeWidth="2" strokeLinecap="round" />
      <g style={animated ? ({ "--gm-travel": "26px" } as React.CSSProperties) : undefined} className={animated ? "animate-cart-drive" : ""}>
        <CartGlyph animated={false} />
      </g>
    </svg>
  );
}

// Simple, still-legible progress indicator for reduced-motion — a static
// cart with three gently pulsing dots instead of any travel animation.
function ReducedMotionIndicator({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 44 30" width={48} height={Math.round((48 * 30) / 44)} role="presentation" aria-hidden="true">
        <CartGlyph animated={false} />
      </svg>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-fairway-400"
            style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1.1s" }}
          />
        ))}
      </div>
      {message && <p className="text-sm font-semibold text-slate-600">{message}</p>}
    </div>
  );
}

export interface GolfMeLoaderProps {
  /** Short, friendly, context-specific status text, e.g. "Finding your best match..." */
  message?: string;
  /** Fixed full-viewport overlay with the illustrated course scene — initial
   * app load, Auto-Match, other major waits. Defaults to a small inline cart
   * for lighter-weight spots (profile loading, chat, round refresh). */
  fullScreen?: boolean;
  /** Inline-mode cart size in px. Ignored when fullScreen. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const INLINE_SIZE_PX: Record<NonNullable<GolfMeLoaderProps["size"]>, number> = { sm: 44, md: 60, lg: 84 };

// Reusable GolfMe loading experience — one component for every async wait in
// the app, from the initial splash to a small profile spinner. Only ever
// shown while something real is actually in flight; never used to
// artificially pad out a fast operation.
export function GolfMeLoader({ message, fullScreen = false, size = "md", className = "" }: GolfMeLoaderProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (fullScreen) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#faf8f2]/95 px-6 backdrop-blur-sm ${className}`}
      >
        <div className="flex w-full max-w-xs flex-col items-center gap-4">
          {reducedMotion ? (
            <ReducedMotionIndicator message={message} />
          ) : (
            <>
              <CourseScene animated />
              {message && <p className="text-sm font-semibold text-slate-600">{message}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  if (reducedMotion) {
    return (
      <div role="status" aria-live="polite" className={`flex items-center gap-3 ${className}`}>
        <ReducedMotionIndicator />
        {message && <p className="text-sm text-slate-500">{message}</p>}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 ${className}`}>
      <InlineCart animated px={INLINE_SIZE_PX[size]} />
      {message && <p className="text-sm text-slate-500">{message}</p>}
    </div>
  );
}
