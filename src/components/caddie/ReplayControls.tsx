import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { formatReplayTime } from "../../lib/replayControls";

// Caddie's own playback controls for the analysis replay (CaddieSwingReplay
// decides when they show: see lib/replayControls). They replace the native
// <video controls> there, whose chrome covered the swing at every coach
// checkpoint and whose fullscreen button opened the OS player, where no
// coaching card can render (Micky, 2026-11-08).
//
// Hidden means faded and click-through, never removed: the buttons stay in
// the accessibility tree and tab order, so VoiceOver and keyboard users can
// always reach play/pause. Focusing them brings them back.
export function ReplayControls({
  videoRef,
  visible,
  paused,
  fullscreen,
  style,
  onPlayPause,
  onToggleFullscreen,
  onInteract,
  onHoldChange,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  visible: boolean;
  paused: boolean;
  fullscreen: boolean;
  style?: CSSProperties;
  onPlayPause: () => void;
  onToggleFullscreen: () => void;
  /** Any use of the controls: restarts the fade-out timer. */
  onInteract: () => void;
  /** True while scrubbing or keyboard-focused inside: the controls must not fade. */
  onHoldChange: (held: boolean) => void;
}) {
  const { t } = useLocale();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubRef = useRef<{ active: boolean; wasPlaying: boolean }>({ active: false, wasPlaying: false });
  const focusHeldRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (!scrubRef.current.active) setTime(video.currentTime);
    };
    sync();
    const events = ["timeupdate", "seeked", "durationchange", "loadedmetadata", "play", "pause", "ended"] as const;
    for (const e of events) video.addEventListener(e, sync);
    return () => {
      for (const e of events) video.removeEventListener(e, sync);
    };
  }, [videoRef]);

  const releaseHold = () => onHoldChange(scrubRef.current.active || focusHeldRef.current);

  function beginScrub() {
    const video = videoRef.current;
    if (!video || scrubRef.current.active) return;
    scrubRef.current = { active: true, wasPlaying: !video.paused };
    // Paused while dragging so the coach checkpoints are not hit mid-drag.
    if (!video.paused) video.pause();
    onHoldChange(true);
    onInteract();
  }
  function endScrub() {
    const video = videoRef.current;
    if (!scrubRef.current.active) return;
    const { wasPlaying } = scrubRef.current;
    scrubRef.current = { active: false, wasPlaying: false };
    releaseHold();
    onInteract();
    if (wasPlaying && video?.paused) onPlayPause();
  }

  const button =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-colors duration-150 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

  return (
    <div
      data-replay-controls
      role="group"
      aria-label={t("caddie.replayControls")}
      className={`absolute z-20 flex items-center gap-1 rounded-2xl bg-gradient-to-t from-black/70 to-black/30 px-1.5 py-1 transition-opacity duration-200 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onInteract}
      onFocus={(e) => {
        onInteract();
        let keyboard = false;
        try {
          keyboard = e.target.matches(":focus-visible");
        } catch {
          keyboard = false;
        }
        if (keyboard) {
          focusHeldRef.current = true;
          onHoldChange(true);
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focusHeldRef.current = false;
        releaseHold();
      }}
    >
      <button type="button" onClick={onPlayPause} aria-label={paused ? t("caddie.replayPlay") : t("caddie.replayPause")} className={button}>
        {paused ? <Play size={20} aria-hidden="true" className="ml-0.5 fill-current" /> : <Pause size={20} aria-hidden="true" className="fill-current" />}
      </button>
      <span aria-hidden="true" className="w-[3.6rem] shrink-0 text-right text-[11px] font-semibold tabular-nums text-white/90">
        {formatReplayTime(time)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        aria-label={t("caddie.replaySeek")}
        aria-valuetext={`${formatReplayTime(time)} / ${formatReplayTime(duration)}`}
        onPointerDown={beginScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
        onChange={(e) => {
          const video = videoRef.current;
          const next = Number(e.target.value);
          if (!video || !Number.isFinite(next)) return;
          video.currentTime = next;
          setTime(next);
          onInteract();
        }}
        className="h-11 min-w-0 flex-1 cursor-pointer accent-brand-gold"
      />
      <span aria-hidden="true" className="w-[3.6rem] shrink-0 text-[11px] font-semibold tabular-nums text-white/60">
        {formatReplayTime(duration)}
      </span>
      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? t("caddie.replayExitFullscreen") : t("caddie.replayFullscreen")}
        className={button}
      >
        {fullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
