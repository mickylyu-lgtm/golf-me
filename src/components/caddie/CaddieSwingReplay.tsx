import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, TriangleAlert } from "lucide-react";
import { X } from "lucide-react";
import type { CaddiePoseData, CaddieSwingPhases } from "../../types";
import { enterNativeVideoFullscreen, getVideoContentRect } from "../../lib/video";
import { useLocale } from "../../i18n/LocaleContext";
import { computeSwingAssessment, segmentStatusAtTime } from "../../lib/swingAssessment";
import type { SwingSegmentId, SwingSegmentStatus } from "../../lib/swingAssessment";
import type { TranslationKey } from "../../i18n/locales/en";
import { Badge } from "../ui/Badge";

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

// Which two edges visually represent each assessed segment — only these
// ever pick up a green/red color; every other edge (face, shoulder line,
// knee/ankle) always stays the neutral base color. Deliberately a small,
// fixed set (see swingAssessment.ts's own header comment) rather than
// trying to color the whole skeleton.
const SEGMENT_EDGES: Record<SwingSegmentId, [string, string][]> = {
  torso: [
    ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"],
  ],
  left_arm: [
    ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"],
  ],
  right_arm: [
    ["right_shoulder", "right_elbow"],
    ["right_elbow", "right_wrist"],
  ],
  hip_sway: [["left_hip", "right_hip"]],
};

// Professional, muted tones (not neon) per the brief's own explicit
// instruction — close to the existing brand green, not a debugging-tool
// palette. "unknown" and the neutral base skeleton intentionally share the
// same subdued tone: an unassessed edge and a low-confidence one should
// both read as "nothing to see here," not draw the eye.
const NEUTRAL_STROKE = "rgba(203, 213, 225, 0.85)"; // slate-300ish
const STATUS_STROKE: Record<SwingSegmentStatus, string> = {
  good: "rgba(21, 128, 61, 0.9)", // fairway-700ish
  needs_improvement: "rgba(220, 38, 38, 0.88)", // red-600ish
  unknown: NEUTRAL_STROKE,
};
const STATUS_DOT: Record<SwingSegmentStatus, string> = {
  good: "rgba(21, 128, 61, 0.95)",
  needs_improvement: "rgba(220, 38, 38, 0.95)",
  unknown: "#ffffff",
};

const SEGMENT_LABEL_KEYS: Record<SwingSegmentId, TranslationKey> = {
  torso: "swingAssessment.segment.torso",
  left_arm: "swingAssessment.segment.leftArm",
  right_arm: "swingAssessment.segment.rightArm",
  hip_sway: "swingAssessment.segment.hipSway",
};
const STATUS_LABEL_KEYS: Record<SwingSegmentStatus, TranslationKey> = {
  good: "swingAssessment.status.good",
  needs_improvement: "swingAssessment.status.needsImprovement",
  unknown: "swingAssessment.status.unknown",
};
const FOCUS_TIP_KEYS: Record<SwingSegmentId, TranslationKey> = {
  torso: "swingAssessment.focusTip.torso",
  left_arm: "swingAssessment.focusTip.leftArm",
  right_arm: "swingAssessment.focusTip.rightArm",
  hip_sway: "swingAssessment.focusTip.hipSway",
};
const SEGMENT_ORDER: SwingSegmentId[] = ["torso", "left_arm", "right_arm", "hip_sway"];
const STATUS_BADGE_TONE: Record<SwingSegmentStatus, "fairway" | "rose" | "slate"> = {
  good: "fairway",
  needs_improvement: "rose",
  unknown: "slate",
};

// "unknown" reuses one generic description across every segment (same
// wording regardless of which segment lacks data) rather than 4 separate
// near-identical sentences; left_arm/right_arm share one description pair
// too since the same cue applies to either arm — only the segment's own
// title (SEGMENT_LABEL_KEYS) differs between them.
function descriptionKey(segment: SwingSegmentId, status: SwingSegmentStatus): TranslationKey {
  if (status === "unknown") return "swingAssessment.description.unknown";
  if (segment === "torso") return status === "good" ? "swingAssessment.description.torsoGood" : "swingAssessment.description.torsoNeedsImprovement";
  if (segment === "hip_sway") return status === "good" ? "swingAssessment.description.hipSwayGood" : "swingAssessment.description.hipSwayNeedsImprovement";
  return status === "good" ? "swingAssessment.description.armGood" : "swingAssessment.description.armNeedsImprovement";
}

function StatusIcon({ status, size = 12 }: { status: SwingSegmentStatus; size?: number }) {
  if (status === "good") return <Check size={size} className="text-fairway-700" />;
  if (status === "needs_improvement") return <TriangleAlert size={size} className="text-red-600" />;
  return <Minus size={size} className="text-slate-400" />;
}

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
  { speed: 0.25, labelKey: "caddie.replaySlowAnalysis", showOverlay: true },
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
  // Pure function of already-fetched poseData/phases (see swingAssessment.ts)
  // — computed once per analysis, not per frame.
  const assessment = useMemo(() => computeSwingAssessment(poseData, phases), [poseData, phases]);
  // Drives the summary panel/legend/focus tip below the video. Updated from
  // inside draw() (see the effect below) only when it actually changes —
  // not on every rAF tick — so this never causes more re-renders than the
  // segment colors visibly changing.
  const [liveStatus, setLiveStatus] = useState<Record<SwingSegmentId, SwingSegmentStatus>>({
    torso: "unknown",
    left_arm: "unknown",
    right_arm: "unknown",
    hip_sway: "unknown",
  });
  const liveStatusRef = useRef(liveStatus);
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

      const statusNow = segmentStatusAtTime(assessment, phases, video.currentTime);
      if (
        statusNow.torso !== liveStatusRef.current.torso ||
        statusNow.left_arm !== liveStatusRef.current.left_arm ||
        statusNow.right_arm !== liveStatusRef.current.right_arm ||
        statusNow.hip_sway !== liveStatusRef.current.hip_sway
      ) {
        liveStatusRef.current = statusNow;
        setLiveStatus(statusNow);
      }
      // A joint gets flagged (small colored ring, see below) only if it's
      // an endpoint of a needs_improvement segment — good/unknown segments
      // communicate entirely through their line color, never a joint
      // marker, so attention naturally goes to the areas that need it
      // (brief's own visual-priority ordering: red areas before green).
      const flaggedJoints = new Set<string>();
      for (const id of SEGMENT_ORDER) {
        if (statusNow[id] !== "needs_improvement") continue;
        for (const [a, b] of SEGMENT_EDGES[id]) {
          flaggedJoints.add(a);
          flaggedJoints.add(b);
        }
      }

      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (const [a, b] of SKELETON_EDGES) {
        const kpA = frame.keypoints[a];
        const kpB = frame.keypoints[b];
        if (!kpA || !kpB) continue;
        const segmentId = SEGMENT_ORDER.find((id) => SEGMENT_EDGES[id].some(([x, y]) => (x === a && y === b) || (x === b && y === a)));
        ctx.strokeStyle = segmentId ? STATUS_STROKE[statusNow[segmentId]] : NEUTRAL_STROKE;
        const [ax, ay] = toCanvas(kpA.x, kpA.y);
        const [bx, by] = toCanvas(kpB.x, kpB.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      // Small dots throughout (point 9: never giant colored joint circles)
      // — only a flagged joint's dot picks up the "needs improvement" red;
      // every other joint stays a plain small white dot regardless of a
      // nearby segment's color, keeping the base skeleton readable.
      for (const [name, kp] of Object.entries(frame.keypoints)) {
        const [x, y] = toCanvas(kp.x, kp.y);
        ctx.fillStyle = flaggedJoints.has(name) ? STATUS_DOT.needs_improvement : "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, flaggedJoints.has(name) ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // `timeupdate` only fires a few times a second (browser-throttled),
    // which is coarse enough that the skeleton visibly lagged behind the
    // actual video frame during playback — looking "broken"/desynced
    // while playing, then snapping into place the instant playback
    // stopped and one final draw() caught up. Driving the redraw off
    // requestAnimationFrame while the video is actually playing keeps it
    // synced every rendered frame instead; `seeked` still covers the
    // paused-scrub case, where no rAF loop is running.
    let rafId: number | null = null;
    function loop() {
      draw();
      if (video && !video.paused && !video.ended) rafId = requestAnimationFrame(loop);
      else rafId = null;
    }
    function startLoop() {
      if (rafId === null) rafId = requestAnimationFrame(loop);
    }
    function stopLoop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      draw(); // one final draw at the exact paused/ended position
    }

    // Observes the container (not the video) — its size is what actually
    // determines canvas dimensions now, and it's the node whose box
    // changes size when customFullscreen toggles (small card <-> full
    // viewport), which ResizeObserver picks up automatically either way.
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    video.addEventListener("loadedmetadata", resizeCanvas);
    video.addEventListener("seeked", draw);
    video.addEventListener("play", startLoop);
    video.addEventListener("pause", stopLoop);
    video.addEventListener("ended", stopLoop);
    resizeCanvas();
    if (!video.paused) startLoop();

    return () => {
      resizeObserver.disconnect();
      video.removeEventListener("loadedmetadata", resizeCanvas);
      video.removeEventListener("seeked", draw);
      video.removeEventListener("play", startLoop);
      video.removeEventListener("pause", stopLoop);
      video.removeEventListener("ended", stopLoop);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [poseData?.analysisFps, showOverlay, assessment, phases]);

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
          // playsInline: without it, iOS Safari can auto-promote playback
          // into its OWN real native fullscreen the instant play() fires —
          // on top of (separate from) our own customFullscreen CSS state —
          // and real native fullscreen can never show the canvas overlay,
          // no matter what we do on our side.
          playsInline
          // translateZ(0) forces both the video and its overlay canvas
          // onto explicit GPU compositing layers in a predictable stacking
          // order. Without it, WebKit's own hardware video-decode layer can
          // occlude a plain sibling canvas specifically WHILE PLAYING (paused
          // frames render through the normal software path and composite
          // fine) — the standard mitigation for that class of bug.
          style={{ transform: "translateZ(0)" }}
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
        {showOverlay && (
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{ transform: "translateZ(0)" }}
          />
        )}
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
      {/* Never shown in fullscreen (point 21 of the brief) — a card this
          size over the video would defeat the point of a minimal fullscreen
          view; exit fullscreen to see it. */}
      {showOverlay && assessment && !customFullscreen && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("swingAssessment.summaryTitle")}</p>
            {/* One compact legend, not repeated per card (point 19). */}
            <div className="flex items-center gap-2.5 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-fairway-700" />
                {t("swingAssessment.status.good")}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-600" />
                {t("swingAssessment.status.needsImprovement")}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                {t("swingAssessment.status.unknown")}
              </span>
            </div>
          </div>
          <div className="flex flex-col divide-y divide-slate-50">
            {SEGMENT_ORDER.map((id) => (
              <div key={id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={liveStatus[id]} size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{t(SEGMENT_LABEL_KEYS[id])}</p>
                    <p className="text-xs text-slate-500">{t(descriptionKey(id, liveStatus[id]))}</p>
                  </div>
                </div>
                <Badge tone={STATUS_BADGE_TONE[liveStatus[id]]} className="shrink-0">
                  {t(STATUS_LABEL_KEYS[liveStatus[id]])}
                </Badge>
              </div>
            ))}
          </div>
          {(() => {
            const focusSegment = SEGMENT_ORDER.find((id) => liveStatus[id] === "needs_improvement");
            if (!focusSegment) return null;
            return (
              <div className="mt-1 rounded-xl bg-red-50 p-2.5">
                <p className="text-xs font-bold text-red-700">{t("swingAssessment.focusTipTitle")}</p>
                <p className="mt-0.5 text-xs text-red-700/90">{t(FOCUS_TIP_KEYS[focusSegment])}</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
