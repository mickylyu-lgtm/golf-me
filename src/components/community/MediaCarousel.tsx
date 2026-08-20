import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { PostMediaItem } from "../../types";

interface MediaCarouselProps {
  media: PostMediaItem[];
  /** Card-scale rendering (fixed max height, cropped to fill) vs. fullscreen
   * lightbox (uncropped, fit within the viewport, hold-right-to-2x on video). */
  variant: "card" | "lightbox";
  /** Card variant only — double-tap opens the fullscreen lightbox at this index. */
  onItemClick?: (index: number) => void;
  initialIndex?: number;
}

const DOUBLE_TAP_MS = 300;
const HOLD_TO_SPEED_UP_MS = 180;

// Instagram-style swipeable media — a single item still renders (just no
// dots/scroll-snap overhead beyond what one slide needs), so PostCard can
// always reach for this instead of branching on media.length itself.
// Scroll-snap + a scroll-position-derived active index, not a drag library
// — nothing else in this codebase pulls one in, and native momentum
// scrolling on a touch device already gives the expected feel for free.
export function MediaCarousel({ media, variant, onItemClick, initialIndex = 0 }: MediaCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const wasHoldingRef = useRef(false);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set());

  // Jump to the tapped slide instantly (no animated scroll) the moment the
  // lightbox mounts, rather than opening on slide 0 every time.
  useEffect(() => {
    const track = trackRef.current;
    if (track && initialIndex > 0) track.scrollLeft = initialIndex * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current !== null) window.clearTimeout(singleTapTimerRef.current);
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    };
  }, []);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex((prev) => (prev === index ? prev : index));
  }

  // Card variant only — a double-tap (within DOUBLE_TAP_MS) opens the
  // fullscreen lightbox; a single tap does nothing here, matching the
  // request that opening fullscreen takes a deliberate double-tap rather
  // than any casual tap on the media.
  function handleCardTap(i: number) {
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current < DOUBLE_TAP_MS;
    lastTapRef.current = now;
    if (isDoubleTap) {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      onItemClick?.(i);
      return;
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
    }, DOUBLE_TAP_MS);
  }

  function togglePlay(item: PostMediaItem, el: HTMLVideoElement) {
    if (el.paused) {
      void el.play();
      setPlayingIds((prev) => new Set(prev).add(item.id));
    } else {
      el.pause();
      setPlayingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  // Hold anywhere on the right half of a fullscreen video to watch it at 2x
  // while held, matching TikTok/Instagram Reels — released (or the finger/
  // cursor leaves) snaps straight back to normal speed. A short delay
  // before engaging keeps a quick tap-to-play/pause on that same half from
  // being misread as a hold.
  function startHold(el: HTMLVideoElement) {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      el.playbackRate = 2;
      wasHoldingRef.current = true;
      holdTimerRef.current = null;
    }, HOLD_TO_SPEED_UP_MS);
  }

  // Releasing after an engaged hold must NOT also toggle play/pause — the
  // browser fires a click right after pointerup, which would otherwise
  // pause the video the instant the golfer lets go of a 2x hold.
  function endHold(el: HTMLVideoElement) {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    el.playbackRate = 1;
  }

  const itemClass = variant === "card" ? "h-80 w-full shrink-0 snap-center object-cover" : "";

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className={`no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth ${variant === "card" ? "rounded-xl" : "h-[85dvh]"}`}
      >
        {media.map((item, i) =>
          item.type === "video" ? (
            variant === "card" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={item.id}
                src={item.url}
                poster={item.thumbnailUrl}
                controls
                playsInline
                preload="metadata"
                className={`${itemClass} bg-black`}
                onClickCapture={(e) => {
                  // Only a plain tap on the video body (not the native
                  // controls bar) counts toward double-tap-to-open —
                  // otherwise tapping play/pause/scrub would also fire it.
                  const target = e.target as HTMLElement;
                  if (target.tagName === "VIDEO") handleCardTap(i);
                }}
              />
            ) : (
              // A per-slide flex-centering box with the video sized off its
              // own intrinsic aspect ratio, anchored directly to the
              // viewport (max-h-[75dvh]) rather than a percentage chain
              // through several ancestors — percentage max-height only
              // resolves against an ancestor with an explicitly-defined
              // (not auto/content-based) height, which an inline-block
              // wrapper shrunk to its content doesn't provide. Also avoids
              // relying on object-fit/object-position on a <video poster>,
              // which WebKit has a history of not respecting — that was
              // pinning landscape clips to the top-left instead of
              // centering them, reading as mostly empty black below.
              <div key={item.id} className="grid h-full w-full shrink-0 snap-center place-items-center">
                <div className="relative inline-block">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    ref={(el) => {
                      if (el) videoElsRef.current.set(item.id, el);
                      else videoElsRef.current.delete(item.id);
                    }}
                    src={item.url}
                    poster={item.thumbnailUrl}
                    playsInline
                    loop
                    preload="metadata"
                    className="block max-h-[75dvh] max-w-full"
                    onClick={(e) => togglePlay(item, e.currentTarget)}
                  />
                  {/* Right-half hold-for-2x zone, layered over the video —
                      left half stays a plain tap-to-play/pause target. */}
                  <div
                    className="absolute inset-y-0 right-0 w-1/2"
                    onPointerDown={() => {
                      const el = videoElsRef.current.get(item.id);
                      if (el) startHold(el);
                    }}
                    onPointerUp={() => {
                      const el = videoElsRef.current.get(item.id);
                      if (el) endHold(el);
                    }}
                    onPointerLeave={() => {
                      const el = videoElsRef.current.get(item.id);
                      if (el) endHold(el);
                    }}
                    onPointerCancel={() => {
                      const el = videoElsRef.current.get(item.id);
                      if (el) endHold(el);
                    }}
                    onClick={() => {
                      if (wasHoldingRef.current) {
                        wasHoldingRef.current = false;
                        return;
                      }
                      const el = videoElsRef.current.get(item.id);
                      if (el) togglePlay(item, el);
                    }}
                  />
                  {!playingIds.has(item.id) && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-white">
                        <Play size={24} fill="currentColor" />
                      </span>
                    </span>
                  )}
                </div>
              </div>
            )
          ) : variant === "card" ? (
            <img
              key={item.id}
              src={item.url}
              alt=""
              loading="lazy"
              className={`${itemClass} cursor-pointer bg-slate-100`}
              onClick={() => handleCardTap(i)}
            />
          ) : (
            <div key={item.id} className="grid h-full w-full shrink-0 snap-center place-items-center">
              <img src={item.url} alt="" loading="lazy" className="block max-h-[75dvh] max-w-full" />
            </div>
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
