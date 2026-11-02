import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CoachCheckpoint } from "../../lib/coachReplay";

// Drives Coach Replay on a real <video>: while it plays, watches the clock
// every animation frame and, the first time playback crosses a checkpoint,
// pauses and lands exactly on that checkpoint's time. Only natural playback
// triggers a freeze. Scrubbing past a checkpoint doesn't, and scrubbing back
// before one re-arms it, so a rewatch coaches again. Pure UI state: nothing
// here is durable or touches the analysis itself.
export function useCoachVideoPauses(videoRef: RefObject<HTMLVideoElement | null>, checkpoints: CoachCheckpoint[], enabled: boolean) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const consumedRef = useRef(new Set<number>());
  const skippedRef = useRef(false);

  useEffect(() => {
    consumedRef.current.clear();
    skippedRef.current = false;
    setActiveIndex(null);
    const video = videoRef.current;
    if (!video || !enabled || checkpoints.length === 0) return;
    setPlaying(!video.paused);

    let raf = 0;
    let last = video.currentTime;
    const tick = () => {
      raf = 0;
      const now = video.currentTime;
      if (!video.paused && !skippedRef.current) {
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
      setPlaying(true);
      last = video.currentTime;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPause = () => setPlaying(false);
    const onSeeking = () => {
      const t = video.currentTime;
      for (const i of [...consumedRef.current]) if (checkpoints[i].timeSeconds > t + 0.02) consumedRef.current.delete(i);
      if (t < checkpoints[0].timeSeconds) skippedRef.current = false;
      last = t;
    };
    const onEnded = () => {
      consumedRef.current.clear();
      skippedRef.current = false;
      setPlaying(false);
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

  const resume = useCallback(() => {
    void videoRef.current?.play().catch(() => {});
  }, [videoRef]);
  const skip = useCallback(() => {
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

  return { active: activeIndex === null ? null : (checkpoints[activeIndex] ?? null), activeIndex, playing, resume, skip, start };
}
