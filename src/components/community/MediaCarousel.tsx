import { useEffect, useRef, useState } from "react";
import type { PostMediaItem } from "../../types";

interface MediaCarouselProps {
  media: PostMediaItem[];
  /** Card-scale rendering (fixed max height, cropped to fill) vs. fullscreen
   * lightbox (uncropped, fit within the viewport). */
  variant: "card" | "lightbox";
  onItemClick?: (index: number) => void;
  initialIndex?: number;
}

// Instagram-style swipeable media — a single item still renders (just no
// dots/scroll-snap overhead beyond what one slide needs), so PostCard can
// always reach for this instead of branching on media.length itself.
// Scroll-snap + a scroll-position-derived active index, not a drag library
// — nothing else in this codebase pulls one in, and native momentum
// scrolling on a touch device already gives the expected feel for free.
export function MediaCarousel({ media, variant, onItemClick, initialIndex = 0 }: MediaCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const trackRef = useRef<HTMLDivElement>(null);

  // Jump to the tapped slide instantly (no animated scroll) the moment the
  // lightbox mounts, rather than opening on slide 0 every time.
  useEffect(() => {
    const track = trackRef.current;
    if (track && initialIndex > 0) track.scrollLeft = initialIndex * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex((prev) => (prev === index ? prev : index));
  }

  const itemClass = variant === "card" ? "h-80 w-full shrink-0 snap-center object-cover" : "h-full w-full shrink-0 snap-center object-contain";

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className={`no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth ${variant === "card" ? "rounded-xl" : "h-full"}`}
      >
        {media.map((item, i) =>
          item.type === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={item.id}
              src={item.url}
              poster={item.thumbnailUrl}
              controls
              playsInline
              preload="metadata"
              className={`${itemClass} bg-black`}
              onClick={(e) => {
                if (onItemClick) {
                  e.preventDefault();
                  onItemClick(i);
                }
              }}
            />
          ) : (
            <img
              key={item.id}
              src={item.url}
              alt=""
              loading="lazy"
              className={`${itemClass} cursor-pointer bg-slate-100`}
              onClick={() => onItemClick?.(i)}
            />
          ),
        )}
      </div>

      {media.length > 1 && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center gap-1.5 ${variant === "card" ? "bottom-2.5" : "bottom-6"}`}>
          {media.map((item, i) => (
            <span
              key={item.id}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"
              } ${variant === "card" ? "shadow-[0_0_2px_rgba(0,0,0,0.5)]" : ""}`}
            />
          ))}
        </div>
      )}

      {media.length > 1 && variant === "card" && (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">
          {activeIndex + 1}/{media.length}
        </span>
      )}
    </div>
  );
}
