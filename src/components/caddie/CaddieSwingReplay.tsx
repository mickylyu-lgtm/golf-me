import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CaddiePoseData, CaddieSwingPhases } from "../../types";
import { enterNativeVideoFullscreen, getVideoContentRect } from "../../lib/video";
import { useLocale } from "../../i18n/LocaleContext";

// Standard COCO-17 joint pairs — only drawn when BOTH ends are present in
// that frame's keypoints. Roboflow's output already had unreliable joints
// filtered out server-side, so "missing" here just means "don't draw a
// line/dot for it," never a fabricated position.
const SKELETON_EDGES: [string, string][] = [
  ["left_eye", "right_eye"],
  ["nose", "left_eye"],
  ["nose", "right_eye"],
  ["left_eye", "left_ear"],
  ["right_eye", "right_ear"],
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

interface PhaseButton {
  labelKey: "swingAnalysis.address" | "swingAnalysis.backswing" | "swingAnalysis.topOfBackswing" | "swingAnalysis.downswing" | "swingAnalysis.impact" | "swingAnalysis.followThrough";
  timestampSeconds: number;
}

function phaseButtons(phases: CaddieSwingPhases | undefined): PhaseButton[] {
  if (!phases) return [];
  const buttons: PhaseButton[] = [];
  if (phases.address.timestampSeconds !== null) buttons.push({ labelKey: "swingAnalysis.address", timestampSeconds: phases.address.timestampSeconds });
  if (phases.backswing.timestampSeconds !== null) buttons.push({ labelKey: "swingAnalysis.backswing", timestampSeconds: phases.backswing.timestampSeconds });
  if (phases.top.timestampSeconds !== null) buttons.push({ labelKey: "swingAnalysis.topOfBackswing", timestampSeconds: phases.top.timestampSeconds });
  if (phases.downswing.timestampSeconds !== null) buttons.push({ labelKey: "swingAnalysis.downswing", timestampSeconds: phases.downswing.timestampSeconds });
  // Impact is a window, never an exact instant (see analyze-swing's
  // SYSTEM_PROMPT) — jumping to its midpoint is the honest "best we can
  // do," not a claim that the midpoint IS the contact frame.
  if (phases.impact.windowStartSeconds !== null && phases.impact.windowEndSeconds !== null) {
    buttons.push({ labelKey: "swingAnalysis.impact", timestampSeconds: (phases.impact.windowStartSeconds + phases.impact.windowEndSeconds) / 2 });
  }
  if (phases.followThrough.timestampSeconds !== null) {
    buttons.push({ labelKey: "swingAnalysis.followThrough", timestampSeconds: phases.followThrough.timestampSeconds });
  }
  return buttons;
}

export interface CaddieSwingReplayProps {
  sourceMediaUrl: string;
  thumbnailUrl?: string;
  poseData?: CaddiePoseData;
  phases?: CaddieSwingPhases;
}

// Two views of the same one video, not two separate rendered/stored files
// (that would double storage for every analysis — see the product brief's
// explicit "avoid doubling video storage" guidance, and it's unnecessary:
// <video>'s native playbackRate already gives a real slow-motion feel).
// "Original" plays at normal speed with no overlay — just the swing as
// shot. "0.5x Analysis" halves playback AND turns on the live keypoint/
// skeleton overlay, since a short (5-15s) swing at full speed makes each
// phase flash by too fast to actually study, even with the jump-to-phase
// buttons below. The overlay only shows in analysis mode so the normal
// view stays clean, uncluttered by dots/lines someone didn't ask to see.
const REPLAY_MODES = [
  { speed: 1, labelKey: "caddie.replayOriginal", showOverlay: false },
  { speed: 0.5, labelKey: "caddie.replaySlowAnalysis", showOverlay: true },
] as const;

export function CaddieSwingReplay({ sourceMediaUrl, thumbnailUrl, poseData, phases }: CaddieSwingReplayProps) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef(poseData?.frames ?? []);
  framesRef.current = poseData?.frames ?? [];
  const [mode, setMode] = useState<(typeof REPLAY_MODES)[number]>(REPLAY_MODES[0]);
  const speed = mode.speed;
  const showOverlay = mode.showOverlay && !!poseData && poseData.frames.length > 0;
  // The overlay canvas is a sibling DOM element positioned on top of the
  // video — that composites fine in normal page flow, but the OS-native
  // fullscreen player (webkitEnterFullscreen/requestFullscreen) takes over
  // the whole screen showing ONLY the <video> itself, no page DOM can
  // render on top of it. So 0.5x Analysis mode (where the overlay is the
  // whole point) uses an in-app "fullscreen" instead — the same video
  // element expanded to fill the viewport via CSS, canvas included, rather
  // than handing off to the OS player. Original mode keeps the real native
  // player (no overlay to lose, and it's the nicer/native experience).
  const [customFullscreen, setCustomFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    if (!customFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [customFullscreen]);

  // Leaving analysis mode (or losing pose data) while mid-custom-fullscreen
  // would otherwise strand the video pinned full-viewport with no overlay
  // reason to be there anymore.
  useEffect(() => {
    if (!showOverlay) setCustomFullscreen(false);
  }, [showOverlay]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!video || !canvas || !container) return;

    // Sized off the CONTAINER, not the video element directly — in
    // customFullscreen the video is h-full w-full (exactly matches the
    // container), and in the normal inline layout the video is also
    // block w-full within the container, so this is equivalent there too,
    // but staying container-relative means the canvas (itself positioned
    // inset-0 against the container) never drifts out of alignment with
    // whatever box the video actually occupies.
    function resizeCanvas() {
      if (!container || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      draw();
    }

    // Nearest-by-timestamp lookup — a linear scan is plenty at this scale
    // (a 15s clip at 8fps is well under 150 frames) and avoids maintaining
    // a second sorted-index structure for what's already a short array.
    function nearestFrame(t: number) {
      const frames = framesRef.current;
      if (frames.length === 0) return undefined;
      let best = frames[0];
      let bestDelta = Math.abs(frames[0].timestampSeconds - t);
      for (const f of frames) {
        const delta = Math.abs(f.timestampSeconds - t);
        if (delta < bestDelta) {
          best = f;
          bestDelta = delta;
        }
      }
      // Half a sample period is the most a "nearest" match should ever be
      // off by — beyond that there's no real data for this moment, so draw
      // nothing rather than a stale pose from a different part of the swing.
      const samplePeriod = 1 / (poseData?.analysisFps ?? 8);
      return bestDelta <= samplePeriod ? best : undefined;
    }

    function draw() {
      if (!video || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const frame = nearestFrame(video.currentTime);
      if (!frame) return;
      const rect = getVideoContentRect(video);
      if (!video.videoWidth || !video.videoHeight || rect.width === 0 || rect.height === 0) return;
      const scaleX = rect.width / video.videoWidth;
      const scaleY = rect.height / video.videoHeight;
      const toCanvas = (x: number, y: number): [number, number] => [rect.left + x * scaleX, rect.top + y * scaleY];

      ctx.strokeStyle = "rgba(74, 222, 128, 0.85)"; // fairway-400-ish, readable on any footage
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (const [a, b] of SKELETON_EDGES) {
        const kpA = frame.keypoints[a];
        const kpB = frame.keypoints[b];
        if (!kpA || !kpB) continue;
        const [ax, ay] = toCanvas(kpA.x, kpA.y);
        const [bx, by] = toCanvas(kpB.x, kpB.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      for (const kp of Object.values(frame.keypoints)) {
        const [x, y] = toCanvas(kp.x, kp.y);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Observes the container (not the video) — its size is what actually
    // determines canvas dimensions now, and it's the node whose box
    // changes size when customFullscreen toggles (small card <-> full
    // viewport), which ResizeObserver picks up automatically either way.
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    video.addEventListener("loadedmetadata", resizeCanvas);
    video.addEventListener("timeupdate", draw);
    video.addEventListener("seeked", draw);
    resizeCanvas();

    return () => {
      resizeObserver.disconnect();
      video.removeEventListener("loadedmetadata", resizeCanvas);
      video.removeEventListener("timeupdate", draw);
      video.removeEventListener("seeked", draw);
    };
  }, [poseData?.analysisFps, showOverlay]);

  const buttons = phaseButtons(phases);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className={customFullscreen ? "fixed inset-0 z-[200] bg-black" : "relative overflow-hidden rounded-2xl bg-black"}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={sourceMediaUrl}
          poster={thumbnailUrl}
          preload="metadata"
          controls
          className={customFullscreen ? "block h-full w-full object-contain" : "block max-h-80 w-full"}
          onClick={(e) => {
            if (!(e.target instanceof HTMLVideoElement)) return;
            if (showOverlay) {
              // In-app fullscreen (see the customFullscreen comment above)
              // — only the FIRST tap opens it; once already full-viewport,
              // a tap should just do the normal play/pause toggle.
              if (!customFullscreen) setCustomFullscreen(true);
            } else {
              // No preventDefault, bubble phase — WebKit only honors
              // webkitEnterFullscreen() as a real user gesture without
              // either of those; both broke fullscreen entirely rather
              // than just fixing the glitch/flash they were meant to fix.
              enterNativeVideoFullscreen(e.target);
            }
          }}
        />
        {showOverlay && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />}
        {customFullscreen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCustomFullscreen(false);
            }}
            aria-label={t("common.close")}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white"
            style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {poseData && poseData.frames.length > 0 && (
        <div className="flex items-center gap-1.5">
          {REPLAY_MODES.map((m) => (
            <button
              key={m.labelKey}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors duration-150 ${
                mode.labelKey === m.labelKey
                  ? "bg-fairway-700 text-white"
                  : "border border-slate-200 text-slate-600 hover:border-fairway-300 hover:text-fairway-700"
              }`}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {buttons.map((b) => (
            <button
              key={b.labelKey}
              onClick={() => {
                const video = videoRef.current;
                if (video) video.currentTime = b.timestampSeconds;
              }}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-700"
            >
              {t(b.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
