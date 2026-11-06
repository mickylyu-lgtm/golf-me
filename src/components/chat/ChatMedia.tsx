import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { ImageOff, Maximize2, Play, VideoOff, Volume2, VolumeX } from "lucide-react";
import {
  DECK_FAN_PX,
  deckAxis,
  deckCardStyle,
  deckDisplaySize,
  deckIndexAfterSwipe,
  formatVideoDuration,
  localWindowUrl,
  videoDisplaySize,
  type ChatMediaItem,
} from "../../lib/chatMedia";
import { chatVideoUrls } from "../../lib/chatVideoClient";
import { useChatImageUrl } from "../../lib/useChatImageUrl";
import type { OutgoingMediaItemState } from "../../types";

// Videos and albums inside a chat bubble (DMs and round chat; rules in
// lib/chatMedia.ts). Every box is sized from the stored width / height
// before any pixel arrives, so nothing in the list moves while media loads
// (the threads' scroll pinning depends on it).
//
// Gestures (the split with the threads' own swipes):
//   - A drag that STARTS on an album deck ([data-chat-deck]) belongs to the
//     deck: sideways flips cards, vertical scrolls the list (touch-action:
//     pan-y). Swipe-to-reply and swipe-left-for-times skip touches that
//     start on a deck (useSwipeToReply / useSwipeToRevealTimes), so an album
//     is replied to from the hold menu; a hold still opens that menu (the
//     long press only cancels on movement).
//   - A single video is not a deck: swipe-to-reply / times work over it as
//     over a photo. Tap = sound on / off, the corner button = fullscreen.
//   - Tap on a deck card opens the fullscreen viewer at that item.

export interface ChatMediaLabels {
  video: string;
  photo: string;
  openFullscreen: string;
  soundOn: string;
  soundOff: string;
  expired: string;
  unavailable: string;
  unsupported: string;
  processing: string;
  album: (n: number) => string;
  position: (n: number, total: number) => string;
  previous: string;
  next: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function ProgressRing({ progress, processing }: { progress: number; processing?: string }) {
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.04, Math.min(1, progress)) * 94.25} 94.25`}
          className="transition-[stroke-dasharray] duration-200 motion-reduce:transition-none"
        />
      </svg>
      {processing && progress >= 0.9 && progress < 1 && <span className="text-[10px] font-semibold text-fixed-white">{processing}</span>}
    </span>
  );
}

function DurationBadge({ ms }: { ms?: number }) {
  if (!ms) return null;
  return (
    <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-fixed-white tabular-nums">
      {formatVideoDuration(ms)}
    </span>
  );
}

function ExpiredBox({ label }: { label: string }) {
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 px-2 text-center text-[11px] font-medium text-slate-500">
      <VideoOff size={18} aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A single video: inline, muted, playsInline; tap for sound
// ---------------------------------------------------------------------------

export function ChatVideo({
  item,
  local,
  labels,
  progress,
  onOpen,
}: {
  item: ChatMediaItem;
  /** This device's own copy (sending / demo): played from the original, its trim window only. */
  local?: OutgoingMediaItemState | null;
  labels: ChatMediaLabels;
  /** 0..1 while sending; undefined once sent. */
  progress?: number;
  onOpen?: () => void;
}) {
  const urls = chatVideoUrls();
  const size = videoDisplaySize(item.width, item.height);
  const poster = useChatImageUrl(item.poster ?? null, local?.posterUrl ?? null, urls);
  const src = useChatImageUrl(item.expired ? null : item.path, local ? localWindowUrl(local.localUrl, local.trim) : null, urls);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const sending = progress !== undefined;

  // Plays (muted) only while mostly on screen; never with reduced motion
  // (a tap starts it then). Off screen it pauses, so a long thread never
  // streams every video at once.
  useEffect(() => {
    const el = videoRef.current;
    const box = boxRef.current;
    if (!el || !box || !src.url || item.expired || typeof IntersectionObserver === "undefined") return;
    const reduced = prefersReducedMotion();
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (reduced && el.muted) return;
          el.play().then(
            () => setBlocked(false),
            () => setBlocked(true),
          );
        } else if (!el.paused) el.pause();
      },
      { threshold: [0, 0.6] },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [src.url, item.expired]);

  function toggleSound() {
    const el = videoRef.current;
    if (!el || failed) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
    if (el.paused) {
      el.play().then(
        () => setBlocked(false),
        () => {
          // Unmuted play refused (no gesture window): fall back to muted.
          el.muted = true;
          setMuted(true);
          el.play().catch(() => setBlocked(true));
        },
      );
    }
  }

  return (
    <div
      ref={boxRef}
      data-chat-video={item.path ?? "expired"}
      className="relative max-w-full overflow-hidden rounded-xl bg-slate-900 select-none [-webkit-touch-callout:none]"
      style={{ width: `${size.width}px`, aspectRatio: `${size.width} / ${size.height}` }}
    >
      {item.expired ? (
        <ExpiredBox label={labels.expired} />
      ) : (
        <>
          {poster.url && <img src={poster.url} alt="" aria-hidden="true" draggable={false} onError={poster.onError} className="absolute inset-0 h-full w-full object-cover" />}
          {src.url && !src.unavailable && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              src={src.url}
              muted
              playsInline
              loop
              preload="metadata"
              poster={poster.url ?? undefined}
              onLoadedData={src.onLoad}
              onError={() => {
                if (local) setFailed(true);
                else src.onError();
              }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <button
            type="button"
            aria-label={muted ? labels.soundOn : labels.soundOff}
            aria-disabled={sending || failed || !src.url ? true : undefined}
            onClick={() => {
              if (!sending) toggleSound();
            }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {(blocked || failed) && !sending && (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-fixed-white">
                <Play size={20} fill="currentColor" className="ml-0.5" />
              </span>
            )}
          </button>
          {(src.unavailable || failed) && !sending && (
            <span className="pointer-events-none absolute inset-x-0 top-1.5 mx-auto w-max rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-fixed-white">
              {failed ? labels.unsupported : labels.unavailable}
            </span>
          )}
          <DurationBadge ms={item.durationMs} />
          {!sending && (
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-fixed-white" aria-hidden="true">
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </span>
          )}
          {onOpen && !sending && (
            <button
              type="button"
              aria-label={labels.openFullscreen}
              onClick={(e) => {
                e.stopPropagation();
                videoRef.current?.pause();
                onOpen();
              }}
              className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-fixed-white"
            >
              <Maximize2 size={14} />
            </button>
          )}
          {sending && <ProgressRing progress={progress ?? 0} processing={labels.processing} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// An album: a stacked deck of cards, swiped sideways inside the bubble
// ---------------------------------------------------------------------------

function DeckCard({
  item,
  local,
  labels,
  style,
  animate,
  index,
  total,
}: {
  item: ChatMediaItem;
  local?: OutgoingMediaItemState | null;
  labels: ChatMediaLabels;
  style: ReturnType<typeof deckCardStyle>;
  animate: boolean;
  index: number;
  total: number;
}) {
  const urls = chatVideoUrls();
  const isVideo = item.kind === "video";
  const picture = useChatImageUrl(isVideo ? (item.poster ?? null) : item.path, isVideo ? (local?.posterUrl ?? null) : (local?.localUrl ?? null), urls);
  const sending = local && !local.done;
  return (
    <div
      data-deck-card={index}
      aria-hidden={style.opacity === 0 || style.z <= total - 3 ? true : undefined}
      className={`absolute top-0 overflow-hidden rounded-xl bg-slate-200 shadow-sm ring-1 ring-black/5 ${animate ? "transition-[transform,opacity] duration-200 ease-out" : ""}`}
      style={{
        left: DECK_FAN_PX,
        right: DECK_FAN_PX,
        bottom: DECK_FAN_PX,
        zIndex: style.z,
        opacity: style.opacity,
        transform: `translate3d(${style.x}px, ${style.y}px, 0) rotate(${style.rotate}deg) scale(${style.scale})`,
      }}
    >
      {item.expired ? (
        <ExpiredBox label={labels.expired} />
      ) : (
        <>
          {!isVideo && item.thumb && <img src={item.thumb} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />}
          {picture.url && !picture.unavailable && (
            <img
              src={picture.url}
              alt={isVideo ? labels.video : labels.photo}
              draggable={false}
              onLoad={picture.onLoad}
              onError={picture.onError}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {picture.unavailable && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100/80 px-2 text-center text-[11px] font-medium text-slate-500">
              <ImageOff size={18} aria-hidden="true" />
              {labels.unavailable}
            </span>
          )}
          {isVideo && (
            <>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-fixed-white">
                  <Play size={18} fill="currentColor" className="ml-0.5" />
                </span>
              </span>
              <DurationBadge ms={item.durationMs} />
            </>
          )}
          {sending && <ProgressRing progress={local.progress} processing={labels.processing} />}
        </>
      )}
    </div>
  );
}

export function ChatAlbumDeck({
  items,
  locals,
  labels,
  onOpen,
}: {
  items: ChatMediaItem[];
  /** This device's own copies (sending / just sent), by position. */
  locals?: OutgoingMediaItemState[] | null;
  labels: ChatMediaLabels;
  onOpen?: (index: number) => void;
}) {
  const size = deckDisplaySize(items);
  const count = items.length;
  const [current, setCurrent] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const drag = useRef<{ id: number; x: number; y: number; t: number; axis: "pending" | "deck" | "scroll" } | null>(null);
  const suppressClick = useRef(0);
  const index = Math.min(current, count - 1);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), axis: "pending" };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    if (d.axis === "pending") {
      d.axis = deckAxis(mx, e.clientY - d.y);
      if (d.axis === "deck") {
        setDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }
    if (d.axis !== "deck") return;
    // Resist past the ends (no wrap).
    const atEdge = (mx > 0 && index === 0) || (mx < 0 && index === count - 1);
    setDx(atEdge ? mx / 4 : mx);
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis === "deck") {
      const mx = e.clientX - d.x;
      const velocity = mx / Math.max(1, Date.now() - d.t);
      setCurrent(deckIndexAfterSwipe(index, count, mx, velocity));
      suppressClick.current = Date.now() + 350;
    }
    setDx(0);
    setDragging(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") setCurrent(Math.min(count - 1, index + 1));
    else if (e.key === "ArrowLeft") setCurrent(Math.max(0, index - 1));
    else if (e.key === "Enter" || e.key === " ") onOpen?.(index);
    else return;
    e.preventDefault();
  }

  return (
    <div
      data-chat-deck
      role="group"
      aria-roledescription="carousel"
      aria-label={labels.album(count)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (Date.now() < suppressClick.current) return;
        onOpen?.(index);
      }}
      className="relative max-w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 [-webkit-touch-callout:none]"
      style={{ width: `${size.width}px`, height: `${size.height}px` }}
    >
      {items.map((item, i) => (
        <DeckCard
          key={i}
          item={item}
          local={locals?.[i] ?? null}
          labels={labels}
          index={i}
          total={count}
          animate={!dragging && !reduced}
          style={deckCardStyle(i, index, count, i === index ? dx : 0, reduced)}
        />
      ))}
      <span
        data-deck-position
        aria-live="polite"
        className="pointer-events-none absolute top-1.5 z-[20] rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-fixed-white tabular-nums"
        style={{ right: DECK_FAN_PX + 6 }}
      >
        {labels.position(index + 1, count)}
      </span>
      {/* Pointer users: previous / next (touch swipes). */}
      {index > 0 && (
        <button
          type="button"
          aria-label={labels.previous}
          onClick={(e) => {
            e.stopPropagation();
            setCurrent(index - 1);
          }}
          className="absolute top-1/2 z-[20] hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-fixed-white pointer-fine:flex"
          style={{ left: DECK_FAN_PX + 4 }}
        >
          <span aria-hidden="true">&lsaquo;</span>
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          aria-label={labels.next}
          onClick={(e) => {
            e.stopPropagation();
            setCurrent(index + 1);
          }}
          className="absolute top-1/2 z-[20] hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-fixed-white pointer-fine:flex"
          style={{ right: DECK_FAN_PX + 4 }}
        >
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A media message's body: a single video, or the deck; then the caption
// ---------------------------------------------------------------------------

export function ChatMediaBody({
  media,
  locals,
  labels,
  progress,
  caption,
  onOpen,
}: {
  media: ChatMediaItem[];
  locals?: OutgoingMediaItemState[] | null;
  labels: ChatMediaLabels;
  /** 0..1 while sending (single video). */
  progress?: number;
  caption?: ReactNode;
  onOpen?: (index: number) => void;
}) {
  const single = media.length === 1 && media[0].kind === "video";
  const width = single ? videoDisplaySize(media[0].width, media[0].height).width : deckDisplaySize(media).width;
  return (
    <div className="max-w-full" style={{ width: `${width}px` }}>
      {single ? (
        <ChatVideo item={media[0]} local={locals?.[0] ?? null} labels={labels} progress={progress} onOpen={onOpen ? () => onOpen(0) : undefined} />
      ) : (
        <ChatAlbumDeck items={media} locals={locals} labels={labels} onOpen={onOpen} />
      )}
      {caption ? <p className="px-2.5 pt-1.5 pb-1 [overflow-wrap:anywhere]">{caption}</p> : null}
    </div>
  );
}
