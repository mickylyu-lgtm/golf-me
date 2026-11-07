import { useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { formatVoiceDuration, voiceSecondsLeft, type VoiceEvent, type VoiceState } from "../../lib/chatVoice";
import { startVoiceRecording } from "../../lib/voiceRecorder";
import { createVoiceSession, type SentVoiceClip, type VoiceNotice, type VoiceOrigin, type VoiceSession } from "../../lib/voiceSession";
import { tapHaptic } from "../../lib/tapFeedback";

export type { VoiceNotice, VoiceOrigin, SentVoiceClip };

export interface HoldToTalkLabels {
  hold: string;
  release: string;
  slideToCancel: string;
  releaseToCancel: string;
  secondsLeft: (n: number) => string;
}

// WeChat-style "Hold to talk" (lib/chatVoice.ts voiceStep): press = record,
// release = send, slide up past VOICE_CANCEL_DY = "Release to cancel", 60 s
// = sent automatically. A medium haptic when recording starts, success when
// it's sent. Touch screens use touch events, not pointer events: WebKit
// fires pointercancel on a finger held still (its own long-press
// recogniser, see useMessageLongPress), which would end every recording.
// touchcancel (a call, a system gesture) and the app going to the
// background throw the recording away; nothing is ever sent by accident.
//
// Fills the textarea's box exactly (the composer keeps its layout); the
// timer, level meter and hints are inside the bar, nothing overlays the
// thread.
//
// `origin` is the conversation on screen. Each press keeps the origin it
// started in (lib/voiceSession.ts), and the clip it delivers carries it, so
// the page sends to that conversation even if a notification / deep link
// has since reused this thread for another one. A hold still in progress
// when the origin changes is cancelled.
export function HoldToTalk({
  origin,
  onClip,
  onNotice,
  labels,
}: {
  origin: VoiceOrigin;
  onClip: (clip: SentVoiceClip) => void;
  onNotice: (n: VoiceNotice, origin?: VoiceOrigin | null) => void;
  labels: HoldToTalkLabels;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VoiceState>({ kind: "idle" });
  // One session per mount (made in the effect below, so StrictMode's
  // mount / unmount / mount gets a fresh one): it owns every attempt.
  const sessionRef = useRef<VoiceSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const cbRef = useRef({ onClip, onNotice });
  cbRef.current = { onClip, onNotice };
  const originRef = useRef<VoiceOrigin>(origin);
  originRef.current = origin;

  // While recording: the timer, the meter and the 60 s limit.
  const recording = state.kind === "recording";
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      const s = session?.state();
      if (!session || s?.kind !== "recording") return;
      const now = performance.now();
      setElapsed(now - s.startedAt);
      setLevel(session.level());
      session.dispatch({ type: "tick", at: now });
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Input. Touch: native listeners (touchstart must be non-passive to stop
  // the callout / text selection / emulated mouse events). Mouse: down on
  // the bar, move / up anywhere.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const session = createVoiceSession({
      start: (signal) => startVoiceRecording({ signal }),
      origin: () => originRef.current,
      onState: (next) => {
        if (next.kind === "starting") {
          setElapsed(0);
          setLevel(0);
        }
        setState(next);
      },
      onClip: (clip) => cbRef.current.onClip(clip),
      onNotice: (n, o) => cbRef.current.onNotice(n, o),
      haptic: (kind) => tapHaptic(kind),
      now: () => performance.now(),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
    sessionRef.current = session;
    const dispatch = (event: VoiceEvent) => session.dispatch(event);
    const y = (e: TouchEvent) => e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      dispatch({ type: "press", y: y(e) });
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      dispatch({ type: "move", y: y(e) });
    };
    const onTouchEnd = () => dispatch({ type: "release", at: performance.now() });
    const onTouchCancel = () => dispatch({ type: "interrupt" });
    const onMouseMove = (e: MouseEvent) => dispatch({ type: "move", y: e.clientY });
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      dispatch({ type: "release", at: performance.now() });
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      dispatch({ type: "press", y: e.clientY });
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "interrupt" });
    };
    const onPageHide = () => dispatch({ type: "interrupt" });
    bar.addEventListener("touchstart", onTouchStart, { passive: false });
    bar.addEventListener("touchmove", onTouchMove, { passive: false });
    bar.addEventListener("touchend", onTouchEnd);
    bar.addEventListener("touchcancel", onTouchCancel);
    bar.addEventListener("mousedown", onMouseDown);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    // The iOS app going to the background ("pause" = didEnterBackground,
    // not the resign-active of a system alert such as the microphone
    // permission prompt, which must not end the first hold).
    const native = Capacitor.isNativePlatform() ? CapacitorApp.addListener("pause", onPageHide) : null;
    return () => {
      bar.removeEventListener("touchstart", onTouchStart);
      bar.removeEventListener("touchmove", onTouchMove);
      bar.removeEventListener("touchend", onTouchEnd);
      bar.removeEventListener("touchcancel", onTouchCancel);
      bar.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      void native?.then((l) => l.remove()).catch(() => {});
      // Leaving (thread switch, back to the keyboard) never sends; a
      // pending microphone request is released when it answers.
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  // The thread was reused for another conversation: a hold still in
  // progress for the old one is cancelled (released clips keep going to
  // their own origin).
  useEffect(() => {
    sessionRef.current?.originChanged();
  }, [origin.kind, origin.id]);

  const active = state.kind !== "idle";
  const recordingNow = state.kind === "recording";
  const cancelArmed = recordingNow && state.cancelArmed;
  const left = recordingNow ? voiceSecondsLeft(elapsed) : null;
  // Four bars, each lit once the level passes its step (a tiny meter that
  // fits the bar's single line).
  const steps = [0.02, 0.08, 0.18, 0.35];
  const timer = left !== null ? labels.secondsLeft(left) : formatVoiceDuration(Math.floor((recordingNow ? elapsed : 0) / 1000) * 1000);
  // Everything lives inside the bar (Micky, 2026-11-06: no dark pop-up over
  // the thread): idle "Hold to talk"; recording "🎙 0:02 ▮▮▮▯ · Slide up to
  // cancel" in the normal tokens; cancel armed = red "Release to cancel";
  // the last 10 s = the timer counting down in amber. One line, same box:
  // the composer's height never changes.
  return (
    <div
      ref={barRef}
      role="button"
      tabIndex={0}
      aria-label={labels.hold}
      aria-pressed={active}
      data-voice-hold={state.kind}
      className={`absolute inset-0 flex items-center justify-center gap-2 overflow-hidden rounded-2xl px-3 text-sm font-semibold whitespace-nowrap select-none [-webkit-touch-callout:none] [touch-action:none] transition-colors duration-150 motion-reduce:transition-none ${
        cancelArmed ? "bg-rose-100 text-rose-700" : active ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-600"
      }`}
    >
      {!active ? (
        labels.hold
      ) : cancelArmed ? (
        <span role="status" className="flex items-center gap-1.5">
          <X size={16} aria-hidden="true" /> {labels.releaseToCancel}
        </span>
      ) : !recordingNow ? (
        <span role="status" className="flex items-center gap-1.5 text-slate-500">
          <Mic size={16} aria-hidden="true" /> {labels.release}
        </span>
      ) : (
        <span role="status" className="flex min-w-0 items-center gap-2">
          <Mic size={16} aria-hidden="true" className="shrink-0 text-rose-500" />
          <span data-voice-timer className={`shrink-0 tabular-nums ${left !== null ? "text-amber-600" : ""}`}>
            {timer}
          </span>
          <span className="flex h-4 shrink-0 items-end gap-0.5" aria-hidden="true" data-voice-level={level.toFixed(2)}>
            {steps.map((s, i) => (
              <span
                key={i}
                className={`w-1 rounded-sm transition-colors duration-100 motion-reduce:transition-none ${level >= s ? "bg-fairway-600" : "bg-slate-300"}`}
                style={{ height: `${6 + i * 3}px` }}
              />
            ))}
          </span>
          {/* Up to two short lines on a narrow phone, still inside the bar's own height. */}
          <span className="line-clamp-2 min-w-0 text-left text-[11px] leading-[1.15] font-medium whitespace-normal text-slate-500">· {labels.slideToCancel}</span>
        </span>
      )}
    </div>
  );
}
