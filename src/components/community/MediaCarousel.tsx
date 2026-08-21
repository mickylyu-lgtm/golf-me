import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import type { PostMediaItem } from "../../types";

interface MediaCarouselProps {
  media: PostMediaItem[];
  /** Card-scale rendering (fixed max height, cropped to fill) vs. fullscreen
   * lightbox (full-bleed edge to edge, also cropped to fill; hold-right-to-2x
   * on video). */
  variant: "card" | "lightbox";
  /** Card variant only — a tap opens the fullscreen lightbox at this index. */
  onItemClick?: (index: number) => void;
  initialIndex?: number;
}

const HOLD_TO_SPEED_UP_MS = 180;
const MAX_ZOOM = 4;
const MIN_ZOOM_TO_STAY_ENGAGED = 1.05;

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
  // A landscape swing video, object-cover'd to fill a portrait phone
  // screen, only ever shows a cropped middle sliver of the frame — the
  // request was to fill with the video's OWN shape instead. Rotating the
  // element 90° and swapping its box to the screen's other axis (CSS only,
  // scoped to `@media (orientation: portrait)` in index.css so it's a
  // no-op the instant the phone is actually turned sideways) fills the
  // screen with the real frame rather than a crop of it, without needing
  // the Screen Orientation Lock API — iOS Safari has never supported
  // locking orientation from web content.
  const [landscapeIds, setLandscapeIds] = useState<Set<string>>(new Set());
  // Pinch-to-zoom + one-finger pan on a fullscreen photo — only ever the
  // active slide, reset the moment the golfer swipes to a different one.
  // Gesture math lives in a ref (updated every touchmove, far too often to
  // put in React state without janking the pinch itself); only the values
  // that actually need to repaint the transform are state.
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const pinchRef = useRef<{ startDist: number; startScale: number; startX: number; startY: number; touchX: number; touchY: number } | null>(null);

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
  // likely of the two to get rejected on some platforms. Graceful
  // fallback either way: if the browser still blocks it, this just leaves
  // the paused/muted state as-is rather than breaking anything, and the
  // normal tap-to-play and hold-for-2x controls are right there.
  useLayoutEffect(() => {
    if (variant !== "lightbox") return;
    const item = media[initialIndex];
    if (!item || item.type !== "video") return;
    const el = videoElsRef.current.get(item.id);
    if (!el) return;
    el.muted = false;
    setUnmutedIds((prev) => new Set(prev).add(item.id));
    el.play()
      .then(() => setPlayingIds((prev) => new Set(prev).add(item.id)))
      .catch(() => {
        // Blocked autoplay-with-sound isn't an error state — the play/pause
        // overlay and normal controls just stay available as a fallback.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swiping to a different photo always starts that photo at 1x, never
  // carrying over whatever zoom/pan was left on the previous one.
  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0 });
  }, [activeIndex]);

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

  function touchDistance(touches: React.TouchList): number {
    const [a, b] = [touches[0], touches[1]];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  // Two fingers pinch to zoom; one finger pans, but only once already
  // zoomed in — at 1x a single finger is the horizontal swipe-between-
  // photos gesture instead, so this leaves that alone entirely.
  function onImageTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = {
        startDist: touchDistance(e.touches),
        startScale: zoom.scale,
        startX: zoom.x,
        startY: zoom.y,
        touchX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        touchY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    } else if (e.touches.length === 1 && zoom.scale > 1) {
      pinchRef.current = {
        startDist: 0,
        startScale: zoom.scale,
        startX: zoom.x,
        startY: zoom.y,
        touchX: e.touches[0].clientX,
        touchY: e.touches[0].clientY,
      };
    } else {
      pinchRef.current = null;
    }
  }

  function onImageTouchMove(e: React.TouchEvent) {
    const start = pinchRef.current;
    if (!start) return;
    // Own this gesture outright once it's underway — otherwise the browser
    // tries to additionally interpret it as its own native pinch-zoom or
    // scroll, fighting the transform being driven by hand here.
    e.preventDefault();
    if (e.touches.length === 2) {
      const scale = Math.min(MAX_ZOOM, Math.max(1, start.startScale * (touchDistance(e.touches) / start.startDist)));
      setZoom({ scale, x: start.startX, y: start.startY });
    } else if (e.touches.length === 1 && start.startScale > 1) {
      const dx = e.touches[0].clientX - start.touchX;
      const dy = e.touches[0].clientY - start.touchY;
      // Panning range grows with zoom level — more room to explore a more
      // zoomed-in image, none at all right at 1x.
      const track = trackRef.current;
      const maxX = track ? ((start.startScale - 1) * track.clientWidth) / 2 : 0;
      const maxY = track ? ((start.startScale - 1) * track.clientHeight) / 2 : 0;
      setZoom({
        scale: start.startScale,
        x: Math.min(maxX, Math.max(-maxX, start.startX + dx)),
        y: Math.min(maxY, Math.max(-maxY, start.startY + dy)),
      });
    }
  }

  function onImageTouchEnd() {
    pinchRef.current = null;
    // Pinching back down past a hair over 1x snaps fully back to 1x/
    // centered — re-enabling swipe-between-photos and drag-to-dismiss,
    // both of which defer to a zoomed image while it's actively engaged.
    if (zoom.scale < MIN_ZOOM_TO_STAY_ENGAGED) setZoom({ scale: 1, x: 0, y: 0 });
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
                  // controls bar) opens fullscreen — otherwise tapping
                  // play/pause/scrub would also fire it.
                  const target = e.target as HTMLElement;
                  if (target.tagName === "VIDEO") onItemClick?.(i);
                }}
              />
            ) : (
              // Full-bleed, edge to edge — Instagram Stories style, not a
              // letterboxed/contained frame. Cropping (object-cover) is the
              // deliberate tradeoff that comes with that: the full frame
              // isn't always visible, only the center-cropped fill.
              // data-video-controls: tells FullscreenMediaViewer's own drag-
              // to-dismiss tracking to require a much more deliberate
              // vertical drag from here before engaging — this area owns
              // tap-to-pause/hold-for-2x, and ordinary finger tremor during
              // those was otherwise nudging the whole viewer's drag state
              // too, producing a visible snap-back jitter on every touch.
              <div key={item.id} className="relative h-full w-full shrink-0 snap-center overflow-hidden" data-video-controls>
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
                  className={`h-full w-full object-cover ${landscapeIds.has(item.id) ? "video-landscape-fill" : ""}`}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget;
                    if (el.videoWidth > el.videoHeight) setLandscapeIds((prev) => new Set(prev).add(item.id));
                  }}
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
            // data-video-controls: same stricter-drag-to-dismiss threshold
            // video's own controls get, so an in-progress pan/pinch here
            // never gets misread as the start of a dismiss drag.
            <div key={item.id} className="h-full w-full shrink-0 snap-center overflow-hidden" data-video-controls>
              <img
                src={item.url}
                alt=""
                loading="lazy"
                onTouchStart={i === activeIndex ? onImageTouchStart : undefined}
                onTouchMove={i === activeIndex ? onImageTouchMove : undefined}
                onTouchEnd={i === activeIndex ? onImageTouchEnd : undefined}
                onTouchCancel={i === activeIndex ? onImageTouchEnd : undefined}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  touchAction: i === activeIndex && zoom.scale > 1 ? "none" : "pan-x",
                  transform: i === activeIndex ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : undefined,
                  transition: pinchRef.current ? "none" : "transform 200ms ease-out",
                }}
              />
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
