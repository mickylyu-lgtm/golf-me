import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { Play } from "lucide-react";
import type { PostMediaItem } from "../../types";
import { useNativeCommunityVideo } from "./useNativeCommunityVideo";
import { useLocale } from "../../i18n/LocaleContext";
import { barsCoverStyle, safeFindBars, thumbResults, useBlurredBackdrop, type BarInsets } from "../../lib/blurredBackdrop";
import { ZoomableImage } from "./ZoomableImage";
import { resolveCommunityMediaUrl, withFirstFrameHint } from "../../lib/videoPlayback";
import { VideoStatusOverlay } from "./VideoStatusOverlay";
import { useVideoPlayback } from "./useVideoPlayback";

interface MediaCarouselProps {
  media: PostMediaItem[];
  /** Card-scale rendering (fixed max height, cropped to fill) vs. fullscreen
   * lightbox (full-bleed edge to edge, video letterboxed/contained rather
   * than cropped so the full frame is always visible, with native controls). */
  variant: "card" | "lightbox";
  /** Card variant only — a tap opens the fullscreen lightbox at this index. */
  onItemClick?: (index: number) => void;
  initialIndex?: number;
  /** Called with the slide in view whenever it changes. */
  onIndexChange?: (index: number) => void;
  /** Card variant: jump (no animation) to this slide when it changes, e.g.
   * to the photo last viewed in the fullscreen viewer. Pass a fresh request
   * on each close, including when returning to the same index again. */
  showSlide?: { index: number };
}

// Instagram-style swipeable media — a single item still renders (just no
// dots/scroll-snap overhead beyond what one slide needs), so PostCard can
// always reach for this instead of branching on media.length itself.
// Scroll-snap + a scroll-position-derived active index, not a drag library
// — nothing else in this codebase pulls one in, and native momentum
// scrolling on a touch device already gives the expected feel for free.
// Wide screens (the sm: breakpoint, where SideNav replaces BottomNav): a
// 320px-tall cover crop of a portrait phone photo across a ~680px-wide card
// showed only a thin strip of it (Micky, 2026-11-02). There the card shows
// the whole picture instead, contained in a taller box. Live, so resizing
// the window (e.g. into macOS full screen) re-lays it out.
const WIDE_QUERY = "(min-width: 640px)";

function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia?.(WIDE_QUERY).matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return;
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

// Feed photo box shape (see MediaCarousel): Instagram's range, 4:5 tall to
// 1.91:1 wide; 4:5 until the first photo's size is known.
export const FEED_PHOTO_MIN_ASPECT = 4 / 5;
export const FEED_PHOTO_MAX_ASPECT = 1.91;
export function feedPhotoBoxAspect(photoAspect: number | null): number {
  if (!photoAspect || !Number.isFinite(photoAspect) || photoAspect <= 0) return FEED_PHOTO_MIN_ASPECT;
  return Math.min(FEED_PHOTO_MAX_ASPECT, Math.max(FEED_PHOTO_MIN_ASPECT, photoAspect));
}
const photoAspectCache = new Map<string, number>();

export function MediaCarousel({ media, variant, onItemClick, initialIndex = 0, onIndexChange, showSlide }: MediaCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const trackRef = useRef<HTMLDivElement>(null);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Jump to the tapped slide instantly (no animated scroll) the moment the
  // lightbox mounts, rather than opening on slide 0 every time.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track && initialIndex > 0) track.scrollLeft = initialIndex * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from the fullscreen viewer: land on the photo last viewed there
  // (Micky, 2026-11-09), not the post's first one.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || showSlide === undefined) return;
    const i = Math.max(0, Math.min(media.length - 1, showSlide.index));
    track.scrollLeft = i * track.clientWidth;
    setActiveIndex(i);
  }, [showSlide, media.length]);
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;

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
    let cancelled = false;
    el.muted = false;
    void el.play().catch(() => {
      // A rejected attempt can arrive after a swipe or Close. It must not
      // restart an offscreen/unmounted video with a second play request.
      if (cancelled || activeIndexRef.current !== initialIndex) return;
      el.muted = true;
      void el.play().catch(() => { /* The native Play control remains available. */ });
    });
    return () => { cancelled = true; el.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swiping to another item stops the one
  // left behind, so only the video on screen ever plays.
  useEffect(() => {
    if (variant !== "lightbox") return;
    media.forEach((item, i) => {
      if (i === activeIndex || item.type !== "video") return;
      videoElsRef.current.get(item.id)?.pause();
    });
  }, [activeIndex, media, variant]);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.max(0, Math.min(media.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
    setActiveIndex((prev) => (prev === index ? prev : index));
  }

  useEffect(() => {
    onIndexChangeRef.current?.(activeIndex);
  }, [activeIndex]);

  const wide = useWideScreen();
  // Feed cards on phones, like Instagram photo posts (Micky, 2026-11-09:
  // "just the image", no blank side bands): the box takes the first photo's
  // own shape, kept between 4:5 (tall) and 1.91:1 (wide), and every item
  // fills it edge to edge. A photo inside that range shows whole; one
  // taller or wider is trimmed evenly to the limit, as Instagram does.
  // Until the first photo's size is known the box is 4:5 (the common
  // phone-photo shape), and sizes are remembered so a revisit never jumps.
  // Desktop follows the selected photo's own proportions. A fixed 576px
  // contain box left broad gray bands around landscape photos. Phone feed
  // cropping stays unchanged; the fullscreen viewer still shows everything.
  const sizingItem = variant === "card" ? (wide ? media[activeIndex] : media.find((m) => m.type !== "video")) : undefined;
  const photoSrc = sizingItem?.type !== "video" ? sizingItem?.url : undefined;
  const [loadedPhoto, setLoadedPhoto] = useState<{ src: string; aspect: number } | null>(null);
  // Tag async measurements with their source, so fast album changes never
  // apply the previous photo's dimensions to the newly selected one.
  const photoAspect = photoSrc
    ? (photoAspectCache.get(photoSrc) ?? (loadedPhoto?.src === photoSrc ? loadedPhoto.aspect : null))
    : null;
  useEffect(() => {
    if (!photoSrc || photoAspectCache.has(photoSrc)) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      const aspect = probe.naturalWidth / probe.naturalHeight;
      photoAspectCache.set(photoSrc, aspect);
      if (live) setLoadedPhoto({ src: photoSrc, aspect });
    };
    probe.src = photoSrc;
    return () => {
      live = false;
    };
  }, [photoSrc]);
  const fitCardToPhoto = variant === "card" && (!wide || !!photoSrc);
  const boxAspect = wide ? (photoAspect ?? FEED_PHOTO_MIN_ASPECT) : feedPhotoBoxAspect(photoAspect);
  const itemClass = variant !== "card" ? "" : wide
    ? `${fitCardToPhoto ? "h-full" : "h-[min(70vh,36rem)]"} w-full shrink-0 snap-center object-contain`
    : "h-full w-full shrink-0 snap-center object-cover";

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        data-gm-media
        // A horizontal swipe on a photo carousel scrolls the carousel; it
        // never changes root tab (RootTabCarousel skips [data-no-swipe]).
        data-no-swipe
        // Programmatic opening/return jumps must be instant. CSS smooth
        // scrolling animates scrollLeft too, fighting an immediate swipe
        // and briefly reporting the slides passed on the way to the target.
        // Native touch momentum and scroll-snap remain browser-managed.
        className={`no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto ${variant === "card" ? "rounded-xl" : "h-dvh"}`}
        style={fitCardToPhoto ? { aspectRatio: String(boxAspect) } : undefined}
      >
        {media.map((item, i) =>
          item.type === "video" ? (
            variant === "card" ? (
              <CardVideo
                key={item.id}
                src={resolveCommunityMediaUrl(item.url) ?? item.url}
                poster={item.thumbnailUrl}
                className={itemClass}
                fit={wide ? "contain" : "cover"}
                onOpen={() => onItemClick?.(i)}
              />
            ) : (
              // Platform playback controls, as in Caddie's Original player:
              // scrub, pause, sound and fullscreen. No competing tap/hold layer.
              <div key={item.id} inert={i !== activeIndex} className="relative h-full w-full shrink-0 snap-center overflow-hidden bg-black" data-native-video-controls>
                <LightboxVideo
                  src={item.nativeControls ? item.url : resolveCommunityMediaUrl(item.url)}
                  poster={item.thumbnailUrl}
                  elRef={(el) => {
                    if (el) videoElsRef.current.set(item.id, el);
                    else {
                      videoElsRef.current.get(item.id)?.pause();
                      videoElsRef.current.delete(item.id);
                    }
                  }}
                />
              </div>
            )
          ) : variant === "card" ? (
            <CardImage key={item.id} src={item.url} className={itemClass} fit={wide ? "contain" : "cover"} onClick={() => onItemClick?.(i)} />
          ) : (
            // Pinch / double-tap zoom and pan (ZoomableImage); resets when
            // swiped away from.
            <ZoomableImage key={item.id} src={item.url} active={i === activeIndex} />
          ),
        )}
      </div>

      {media.length > 1 && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center gap-1.5 ${variant === "card" ? "bottom-2.5" : "bottom-6"}`}>
          {media.map((item, i) => (
            <span
              key={item.id}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === activeIndex ? "w-4 bg-fixed-white" : "w-1.5 bg-fixed-white/50"
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

// Card-variant media fill a fixed box with object-cover, which already hides
// any letterbox from a mismatched shape. Black bars baked into the picture
// itself (an editing or social app's square/4:5 export) would still show, so
// they're found (see blurredBackdrop) and zoomed out of the box. Not when
// the card shows the whole picture (fit "contain", wide screens): zooming
// would crop it again.
function BarCropBox({ className, bars, aspect, children }: {
  className: string;
  bars: BarInsets | null;
  aspect: number | null;
  children: (style: React.CSSProperties | undefined, className: string) => React.ReactNode;
}) {
  if (!bars || !aspect) return <>{children(undefined, className)}</>;
  return (
    <div className={`${className} relative overflow-hidden bg-slate-100 [container-type:size]`}>
      {children(barsCoverStyle(bars, aspect), "")}
    </div>
  );
}

function CardImage({ src, className, fit, onClick }: { src: string; className: string; fit: "cover" | "contain"; onClick: () => void }) {
  const [found, setFound] = useState<{ bars: BarInsets | null; aspect: number } | null>(null);
  return (
    <BarCropBox className={className} bars={fit === "cover" ? (found?.bars ?? null) : null} aspect={found?.aspect ?? null}>
      {(style, cls) => (
        <img
          src={src}
          alt=""
          loading="lazy"
          // CORS so the picture can be read for the bar scan; GolfMe's
          // Storage buckets send the header.
          crossOrigin="anonymous"
          style={style}
          className={`${cls} cursor-pointer bg-slate-100`}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (found) return;
            setFound({ bars: safeFindBars(img), aspect: img.naturalWidth / Math.max(img.naturalHeight, 1) });
          }}
          onClick={onClick}
        />
      )}
    </BarCropBox>
  );
}

function CardVideo({ src, poster, className, fit, onOpen }: {
  src: string;
  poster?: string;
  className: string;
  fit: "cover" | "contain";
  onOpen: () => void;
}) {
  const { t } = useLocale();
  const scan = useBlurredBackdrop(poster);
  const playback = useVideoPlayback(src);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeVideo = useNativeCommunityVideo(videoRef, src);
  const posterUsable = !!poster && thumbResults.get(poster) !== "load-error";
  return (
    <BarCropBox className={className} bars={fit === "cover" ? (scan?.bars ?? null) : null} aspect={scan?.aspect ?? null}>
      {(style, cls) => (
        <div className={style ? "h-full w-full" : `${cls} relative`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={withFirstFrameHint(src, posterUsable)}
            poster={posterUsable ? poster : undefined}
            playsInline
            preload="metadata"
            style={style}
            className={style ? "bg-black" : `h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} bg-black`}
            ref={(el) => { videoRef.current = el; playback.ref(el); }}
            {...playback.handlers}
          />
          <button
            type="button"
            aria-label={t("caddie.replayFullscreen")}
            onClick={() => nativeVideo.open(onOpen, () => videoRef.current?.pause())}
            className="absolute inset-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
          >
            {playback.status.phase === "ok" && (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white">
                <Play size={20} fill="currentColor" aria-hidden="true" />
              </span>
            )}
          </button>
          <VideoStatusOverlay status={playback.status} onRetry={playback.retry} />
        </div>
      )}
    </BarCropBox>
  );
}

// The fullscreen viewer's video, with the same loading / error / retry
// states as the card. Fills its (relative) slide.
function LightboxVideo({ src, poster, elRef }: {
  src: string | undefined;
  poster?: string;
  elRef: (el: HTMLVideoElement | null) => void;
  onClick?: (e: React.MouseEvent<HTMLVideoElement>) => void;
  /** The platform's controls; such a video plays once (no loop), like the native player. */
  controls?: boolean;
}) {
  const playback = useVideoPlayback(src);
  const playbackRef = playback.ref;
  const forwardedRef = useRef(elRef);
  forwardedRef.current = elRef;
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    forwardedRef.current(el);
    playbackRef(el);
  }, [playbackRef]);
  const posterUsable = !!poster && thumbResults.get(poster) !== "load-error";
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={setVideoRef}
        src={withFirstFrameHint(src, posterUsable)}
        poster={posterUsable ? poster : undefined}
        playsInline
        controls
        tabIndex={0}
        preload="metadata"
        className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] h-[calc(100%-env(safe-area-inset-top)-env(safe-area-inset-bottom)-6.5rem)] w-full object-contain"
        onError={playback.handlers.onError}
        onPlay={playback.handlers.onPlay}
        onWaiting={playback.handlers.onWaiting}
        onPlaying={playback.handlers.onPlaying}
        onPause={playback.handlers.onPause}
        onCanPlay={playback.handlers.onCanPlay}
        onLoadedMetadata={playback.handlers.onLoadedMetadata}
      />
      <VideoStatusOverlay status={playback.status} onRetry={playback.retry} />
    </>
  );
}
