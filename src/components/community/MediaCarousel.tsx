import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import type { PostMediaItem } from "../../types";
import { enterNativeVideoFullscreen } from "../../lib/video";

interface MediaCarouselProps {
  media: PostMediaItem[];
  /** Card-scale rendering (fixed max height, cropped to fill) vs. fullscreen
   * lightbox (full-bleed edge to edge, video letterboxed/contained rather
   * than cropped so the full frame is always visible; hold-right-to-2x on
   * video). */
  variant: "card" | "lightbox";
  /** Card variant only — a tap opens the fullscreen lightbox at this index. */
  onItemClick?: (index: number) => void;
  initialIndex?: number;
}

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
  const holdTimerRef = useRef<number | null>(null);
  const wasHoldingRef = useRef(false);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set());
  // Tracks which videos are currently UNmuted (positive tracking — a video
  // element itself starts muted by default, and only the autoplay effect
  // below or an explicit tap flips one into this set).
  const [unmutedIds, setUnmutedIds] = useState<Set<string>>(new Set());
  // Jump to the tapped slide instantly (no animated scroll) the moment the
  // lightbox mounts, rather than opening on slide 0 every time.
  useEffect(() => {
    const track = trackRef.current;
    if (track && initialIndex > 0) track.scrollLeft = initialIndex * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening fullscreen on a playing feed video should keep it playing (not
  // drop back to a paused poster the golfer has to tap again) AND unmute
  // it — the tap that opened this viewer IS the explicit interaction
  // browsers require before allowing audio, so this rides that same user
  // gesture. useLayoutEffect (not useEffect) to run as close to that click
  // as React allows, before the browser paints — autoplay-with-sound
  // policies are stricter the further a play() call drifts from the
  // original gesture, and effects that fire after paint are the more
  // likely of the two to get rejected on some platforms.
  //
  // The unmuted play() can still get rejected (the gesture window from tap
  // -> React re-render -> this component mounting is often already too
  // long, especially on iOS Safari) — when it does, the browser rejects
  // play() entirely, not just the audio, which used to leave the video
  // sitting paused on its poster with nothing but the play button to fix
  // it. Falling back to a muted play() guarantees it actually starts
  // (every browser allows muted autoplay), matching "opens already
  // playing" over "opens with sound" when the two can't both be had.
  useLayoutEffect(() => {
    if (variant !== "lightbox") return;
    const item = media[initialIndex];
    if (!item || item.type !== "video") return;
    const el = videoElsRef.current.get(item.id);
    if (!el) return;
    el.muted = false;
    el.play()
      .then(() => {
        setPlayingIds((prev) => new Set(prev).add(item.id));
        setUnmutedIds((prev) => new Set(prev).add(item.id));
      })
      .catch(() => {
        el.muted = true;
        el.play()
          .then(() => setPlayingIds((prev) => new Set(prev).add(item.id)))
          .catch(() => {
            // Autoplay blocked entirely even muted — rare, but not an error
            // state. The play/pause overlay and normal controls are still
            // right there as a fallback.
          });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    };
  }, []);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex((prev) => (prev === index ? prev : index));
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

  function toggleMute(item: PostMediaItem, el: HTMLVideoElement) {
    el.muted = !el.muted;
    setUnmutedIds((prev) => {
      const next = new Set(prev);
      if (el.muted) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
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
        className={`no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth ${variant === "card" ? "rounded-xl" : "h-dvh"}`}
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
                  // controls bar) triggers this — otherwise tapping
                  // play/pause/scrub would also fire it. Goes straight to
                  // the native fullscreen player (±10s skip, time bar) in
                  // one tap, same as Caddie's own video, rather than the
                  // custom in-app lightbox — that stays reserved for photo
                  // posts and multi-item posts, where swiping between
                  // items is the point.
                  if (e.target instanceof HTMLVideoElement) {
                    // Without this, the native controls' own click-to-toggle-
                    // play/pause default action still fires right after —
                    // colliding with fullscreen entry and showing as a
                    // glitch/flash in and back out.
                    e.preventDefault();
                    enterNativeVideoFullscreen(e.target);
                  }
                }}
              />
            ) : (
              // Full-bleed, edge to edge, but the video itself is
              // letterboxed/contained (object-contain on a black backdrop)
              // so the full frame is always visible instead of cropped.
              // data-video-controls: tells FullscreenMediaViewer's own drag-
              // to-dismiss tracking to require a much more deliberate
              // vertical drag from here before engaging — this area owns
              // tap-to-pause/hold-for-2x, and ordinary finger tremor during
              // those was otherwise nudging the whole viewer's drag state
              // too, producing a visible snap-back jitter on every touch.
              <div key={item.id} className="relative h-full w-full shrink-0 snap-center overflow-hidden bg-black" data-video-controls>
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
                  className="h-full w-full object-contain"
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
                {/* Fullscreen opens unmuted on the triggering gesture, but a
                    normal mute/unmute toggle stays available afterward —
                    sits above the hold-for-2x zone in stacking order so a
                    tap here is caught by the button, not read as a hold. */}
                <button
                  type="button"
                  aria-label={unmutedIds.has(item.id) ? "Mute" : "Unmute"}
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    const el = videoElsRef.current.get(item.id);
                    if (el) toggleMute(item, el);
                  }}
                >
                  {unmutedIds.has(item.id) ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
              </div>
            )
          ) : variant === "card" ? (
            <img
              key={item.id}
              src={item.url}
              alt=""
              loading="lazy"
              className={`${itemClass} cursor-pointer bg-slate-100`}
              onClick={() => onItemClick?.(i)}
            />
          ) : (
            <div key={item.id} className="h-full w-full shrink-0 snap-center overflow-hidden">
              <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
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
