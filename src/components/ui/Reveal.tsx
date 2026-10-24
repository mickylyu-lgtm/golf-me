import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// The build-time prerender of the public landing page (scripts/prerender-
// landing.mjs renders Welcome with react-dom/server, no DOM at all) must
// capture every section fully visible — otherwise the static HTML Google
// reads would carry `opacity-0` on everything below the fold. The
// <html data-prerender> check is for a browser-driven capture if one is
// ever used instead.
function isPrerendering(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.hasAttribute("data-prerender");
}

interface RevealProps {
  children: ReactNode;
  delayMs?: number;
  className?: string;
  id?: string;
}

// Fades a section in the moment it actually scrolls into view, once, then
// leaves it settled — never replays on scroll-away-and-back, never
// re-triggers on remount. Used across the Welcome landing page so a slow
// scroll always sees the "unfolding," rather than an animation that
// already finished off-screen (a fixed page-load delay) long before anyone
// scrolled far enough to see it. `prefers-reduced-motion` skips the
// observer entirely and shows content immediately.
export function Reveal({ children, delayMs = 0, className = "", id }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(() => prefersReducedMotion() || isPrerendering());

  useEffect(() => {
    if (revealed) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={`${className} ${revealed ? "animate-slide-up-slow" : "opacity-0"}`}
      style={revealed ? { animationDelay: `${delayMs}ms`, animationFillMode: "backwards" } : undefined}
    >
      {children}
    </div>
  );
}
