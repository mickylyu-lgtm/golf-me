import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CoachCheckpoint } from "../../lib/coachReplay";
import { isVideoInNativeFullscreen } from "../../lib/video";

// Drives Coach Replay on a real <video>: while it plays, watches the clock
// every animation frame and, the first time playback crosses a checkpoint,
// pauses and lands exactly on that checkpoint's time. Only natural playback
// triggers a freeze. Scrubbing past a checkpoint doesn't, and scrubbing back
// before one re-arms it, so a rewatch coaches again. Pure UI state: nothing
// here is durable or touches the analysis itself.
//
// `ended` is true once a coached pass has played to the end of the clip
// (the summary card's cue); playing, seeking or dismissing clears it.
export function useCoachVideoPauses(videoRef: RefObject<HTMLVideoElement | null>, checkpoints: CoachCheckpoint[], enabled: boolean) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const consumedRef = useRef(new Set<number>());
  const skippedRef = useRef(false);

  useEffect(() => {
    consumedRef.current.clear();
    skippedRef.current = false;
    setActiveIndex(null);
    setEnded(false);
    const video = videoRef.current;
    // No checkpoints can still mean a summary card, so keep listening.
    if (!video || !enabled) return;
    setPlaying(!video.paused);

    let raf = 0;
    let last = video.currentTime;
    const tick = () => {
      raf = 0;
      const now = video.currentTime;
      // Never freeze inside the OS fullscreen player: no card can show there,
      // so a pause would just stop the swing with nothing to continue it.
      if (!video.paused && !skippedRef.current && !isVideoInNativeFullscreen(video)) {
        for (let i = 0; i < checkpoints.length; i++) {
          const at = checkpoints[i].timeSeconds;
          if (consumedRef.current.has(i) || at < last - 0.001 || at > now) continue;
          consumedRef.current.add(i);
          video.pause();
          video.currentTime = at;
          setActiveIndex(i);
          break;
        }
      }
      last = video.currentTime;
      if (!video.paused && !video.ended) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      // Playing again (our Continue, or the native control) dismisses the card.
      setActiveIndex(null);
      setEnded(false);
      setPlaying(true);
      last = video.currentTime;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPause = () => setPlaying(false);
    const onSeeking = () => {
      const t = video.currentTime;
      for (const i of [...consumedRef.current]) if (checkpoints[i].timeSeconds > t + 0.02) consumedRef.current.delete(i);
      if (checkpoints.length > 0 && t < checkpoints[0].timeSeconds) skippedRef.current = false;
      // Scrubbing back means rewatching; scrubbing to the very end is not a finished pass.
      setEnded(false);
      last = t;
    };
    const onEnded = () => {
      consumedRef.current.clear();
      skippedRef.current = false;
      setPlaying(false);
      setEnded(true);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("ended", onEnded);
    if (!video.paused) raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef, checkpoints, enabled]);

  // Continue, the card's own auto-continue and the play control can land in
  // the same moment; only the first one starts playback. A play() that is
  // refused leaves the card up, so Continue can be tapped again.
  const playPendingRef = useRef(false);
  const resume = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.paused || playPendingRef.current) return;
    playPendingRef.current = true;
    void video
      .play()
      .catch(() => {})
      .finally(() => {
        playPendingRef.current = false;
      });
  }, [videoRef]);
  const skip = useCallback(() => {
    if (playPendingRef.current) return;
    skippedRef.current = true;
    resume();
  }, [resume]);
  // From the strip's play button: start over if the last checkpoint is
  // already behind us, so "Play Coach Replay" always means the full lesson.
  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const lastAt = checkpoints[checkpoints.length - 1]?.timeSeconds ?? 0;
    if (video.ended || video.currentTime >= lastAt) {
      consumedRef.current.clear();
      skippedRef.current = false;
      video.currentTime = 0;
    }
    resume();
  }, [videoRef, checkpoints, resume]);
  const dismissEnded = useCallback(() => setEnded(false), []);

  return { active: activeIndex === null ? null : (checkpoints[activeIndex] ?? null), activeIndex, playing, ended, dismissEnded, resume, skip, start };
}
