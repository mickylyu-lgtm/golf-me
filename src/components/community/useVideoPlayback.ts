import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  MEDIA_ERR_ABORTED,
  VIDEO_SPINNER_DELAY_MS,
  VIDEO_STALL_TIMEOUT_MS,
  classifyVideoFailure,
  isPrivateSignedUrl,
  signedUrlExpiresAt,
  type ProbeResult,
  type VideoFailure,
} from "../../lib/videoPlayback";

export type VideoPlaybackStatus = { phase: "ok" } | { phase: "loading" } | { phase: "checking" } | { phase: "error"; failure: VideoFailure };

const PROBE_TIMEOUT_MS = 8_000;

// One HEAD request (a CORS-safelisted method, so no preflight) tells a dead
// or forbidden link apart from a file this device can't decode. No body is
// read, nothing is logged, and credentials are never sent.
async function probe(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url.split("#")[0], { method: "HEAD", cache: "no-store", credentials: "omit", signal: controller.signal });
    // Some servers refuse HEAD; that says nothing about the file.
    if (res.status === 405 || res.status === 501) return undefined;
    return { kind: "status", status: res.status };
  } catch {
    return { kind: "network-error" };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Loading / error / retry state for one <video>. Spread `handlers` onto the
 * element (composing with any handlers it already has) and render
 * <VideoStatusOverlay> next to it. Retry reloads the same element and puts
 * the playhead back where it was; it is only offered for network failures.
 */
export function useVideoPlayback(src: string | undefined, { playOnRetry = false }: { playOnRetry?: boolean } = {}) {
  const [status, setStatus] = useState<VideoPlaybackStatus>({ phase: "ok" });
  const elRef = useRef<HTMLVideoElement | null>(null);
  const spinnerTimer = useRef<number | null>(null);
  const stallTimer = useRef<number | null>(null);
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null);
  const failingRef = useRef(false);
  // Whether the golfer (or feed autoplay) last asked it to play — an errored
  // element doesn't reliably report paused, so this is what Retry restores.
  const wantsPlayRef = useRef(false);
  const srcRef = useRef(src);
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  const clearTimers = useCallback(() => {
    if (spinnerTimer.current !== null) window.clearTimeout(spinnerTimer.current);
    if (stallTimer.current !== null) window.clearTimeout(stallTimer.current);
    spinnerTimer.current = null;
    stallTimer.current = null;
  }, []);

  const fail = useCallback(
    async (el: HTMLVideoElement | null, stalled: boolean) => {
      const url = srcRef.current;
      if (!url || failingRef.current) return;
      const code = el?.error?.code ?? null;
      if (!stalled && code === MEDIA_ERR_ABORTED) return; // a load we replaced ourselves
      failingRef.current = true;
      clearTimers();
      setStatus({ phase: "checking" });
      const expiresAt = isPrivateSignedUrl(url) ? signedUrlExpiresAt(url) : null;
      const expiredPrivateLink = expiresAt !== null && expiresAt <= Date.now();
      const probeResult = expiredPrivateLink ? undefined : await probe(url);
      if (srcRef.current !== url) return; // the video moved on meanwhile
      setStatus({ phase: "error", failure: classifyVideoFailure({ mediaErrorCode: code, probe: probeResult, stalled, expiredPrivateLink }) });
    },
    [clearTimers],
  );

  // A play/buffer attempt: show a spinner if it takes a moment, and give up
  // (as a retryable network failure) if nothing moves for a long while.
  const startWaiting = useCallback(
    (el: HTMLVideoElement) => {
      if (failingRef.current) return;
      clearTimers();
      spinnerTimer.current = window.setTimeout(() => setStatus((s) => (s.phase === "ok" ? { phase: "loading" } : s)), VIDEO_SPINNER_DELAY_MS);
      stallTimer.current = window.setTimeout(() => {
        if (el.readyState < 3 && !el.paused) void fail(el, true);
      }, VIDEO_STALL_TIMEOUT_MS);
    },
    [clearTimers, fail],
  );

  const settle = useCallback(() => {
    if (failingRef.current) return;
    clearTimers();
    setStatus((s) => (s.phase === "loading" ? { phase: "ok" } : s));
  }, [clearTimers]);

  // A different video (or a re-resolved URL) starts clean.
  useEffect(() => {
    failingRef.current = false;
    resumeRef.current = null;
    clearTimers();
    setStatus({ phase: "ok" });
  }, [src, clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);

  const retry = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    // The Retry tap is a user gesture, so an autoplaying feed video can
    // start again even if it failed before it ever played.
    resumeRef.current = { time: el.currentTime || 0, play: wantsPlayRef.current || playOnRetry };
    failingRef.current = false;
    setStatus({ phase: "ok" });
    el.load();
    startWaiting(el);
  }, [startWaiting, playOnRetry]);

  const handlers = {
    onError: (e: React.SyntheticEvent<HTMLVideoElement>) => void fail(e.currentTarget, false),
    onPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      wantsPlayRef.current = true;
      startWaiting(e.currentTarget);
    },
    onWaiting: (e: React.SyntheticEvent<HTMLVideoElement>) => startWaiting(e.currentTarget),
    onPlaying: settle,
    onPause: () => {
      wantsPlayRef.current = false;
      settle();
    },
    onCanPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const el = e.currentTarget;
      // Loaded and playable, yet no picture: WebKit can do this with a video
      // track it can't decode (it plays the audio over a black frame and
      // raises no error). Say so instead of showing a silent black box.
      if (el.videoWidth === 0 && el.videoHeight === 0 && !failingRef.current) {
        failingRef.current = true;
        clearTimers();
        setStatus({ phase: "error", failure: "unsupported" });
        return;
      }
      settle();
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const resume = resumeRef.current;
      if (!resume) return;
      resumeRef.current = null;
      const el = e.currentTarget;
      if (resume.time > 0) el.currentTime = Number.isFinite(el.duration) ? Math.min(resume.time, Math.max(el.duration - 0.1, 0)) : resume.time;
      if (resume.play) el.play().catch(() => {});
    },
  };

  const ref = useCallback((el: HTMLVideoElement | null) => {
    elRef.current = el;
  }, []);

  return { status, handlers, retry, ref };
}
