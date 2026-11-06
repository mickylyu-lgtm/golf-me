// Who owns the microphone: one hold-to-talk bar's recording attempts
// (components/chat/HoldToTalk.tsx renders it; lib/chatVoice.ts voiceStep is
// the gesture state machine; lib/voiceRecorder.ts acquires the resources).
// No React / DOM imports, so tests/voiceSession.test.ts drives it under
// plain node with fake microphones.
//
// Every press makes a new Attempt (its own id and AbortController). Only
// the CURRENT, still-live attempt may become the recording, change the
// bar's state, show a notice or deliver a clip. Release, slide-cancel,
// "too short", an interrupt (touchcancel, the app hidden / backgrounded),
// a newer press and dispose (unmount) each end the attempt: its
// AbortController aborts, so a microphone that answers later is released
// by the recorder itself, and if a recording still reaches us it is
// discarded here. A late success or failure of an old attempt never
// touches the newer one.
//
// A released recording (the "stop" effect) is the one way to send: its clip
// is delivered at most once, even if the recorder reports twice.
import { voiceStep, type VoiceEvent, type VoiceState } from "./chatVoice.ts";
import type { ActiveRecording, VoiceClip, VoiceRecorderErrorReason } from "./voiceRecorder.ts";

export type VoiceNotice = "denied" | "unavailable" | "tooShort" | "failed";
export type VoiceHaptic = "medium" | "success" | "tap";

export interface VoiceSessionDeps {
  /** Acquire the microphone + recorder for one attempt (lib/voiceRecorder.ts startVoiceRecording). */
  start(signal: AbortSignal): Promise<ActiveRecording>;
  onState(state: VoiceState): void;
  onClip(clip: VoiceClip): void;
  onNotice(notice: VoiceNotice): void;
  haptic?(kind: VoiceHaptic): void;
  now(): number;
  /** Revoke a clip's object URL that will never be sent. */
  revokeUrl?(url: string): void;
}

export interface VoiceSession {
  dispatch(event: VoiceEvent): void;
  state(): VoiceState;
  /** The current recording's loudness (0 when none). */
  level(): number;
  /** Unmount: ends any attempt (never sends one still being held); later events are ignored. */
  dispose(): void;
}

interface Attempt {
  id: number;
  abort: AbortController;
  live: boolean;
  rec: ActiveRecording | null;
}

function reasonOf(err: unknown): VoiceRecorderErrorReason {
  const r = err && typeof err === "object" ? (err as { reason?: unknown }).reason : undefined;
  return r === "denied" || r === "aborted" ? r : "unavailable";
}

export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  let state: VoiceState = { kind: "idle" };
  let current: Attempt | null = null;
  let nextId = 0;
  let disposed = false;

  const setState = (next: VoiceState) => {
    if (next === state) return;
    state = next;
    if (!disposed) deps.onState(next);
  };

  // Ends an attempt: idempotent; a still-pending microphone request is
  // aborted, a recording that hasn't been stopped is thrown away.
  const end = (a: Attempt | null, keepRecording = false) => {
    if (!a || !a.live) return;
    a.live = false;
    a.abort.abort();
    if (!keepRecording && a.rec) {
      const rec = a.rec;
      a.rec = null;
      try {
        rec.discard();
      } catch {
        // The recorder's own cleanup is unconditional; nothing to add.
      }
    }
  };

  const owns = (a: Attempt) => !disposed && current === a && a.live;

  const begin = () => {
    end(current);
    const attempt: Attempt = { id: ++nextId, abort: new AbortController(), live: true, rec: null };
    current = attempt;
    let pending: Promise<ActiveRecording>;
    try {
      pending = deps.start(attempt.abort.signal);
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (rec) => {
        // A later answer for a given-up or replaced attempt: only its own
        // recording is released; the newer attempt is untouched.
        if (!owns(attempt) || state.kind !== "starting") {
          try {
            rec.discard();
          } catch {
            // ignore
          }
          return;
        }
        attempt.rec = rec;
        deps.haptic?.("medium");
        setState(voiceStep(state, { type: "started", at: deps.now() }).state);
      },
      (err) => {
        const reason = reasonOf(err);
        if (current !== attempt) return; // replaced by a newer hold: say nothing, change nothing
        const holding = attempt.live && !disposed && state.kind === "starting";
        end(attempt);
        if (holding) setState(voiceStep(state, { type: "failed" }).state);
        if (reason === "aborted" || disposed) return;
        // A denial is worth saying even if the finger already lifted (the
        // golfer just answered the prompt); "unavailable" only while held.
        if (holding || reason === "denied") deps.onNotice(reason);
      },
    );
  };

  const send = (a: Attempt | null, durationMs: number) => {
    const rec = a?.rec ?? null;
    if (a) a.rec = null;
    end(a, true);
    if (!rec) return;
    deps.haptic?.("success");
    let delivered = false;
    rec.stop(durationMs).then(
      (clip) => {
        if (delivered) {
          if (clip) deps.revokeUrl?.(clip.localUrl);
          return;
        }
        delivered = true;
        if (clip) deps.onClip(clip);
        else deps.onNotice("failed");
      },
      () => {
        if (delivered) return;
        delivered = true;
        deps.onNotice("failed");
      },
    );
  };

  const dispatch = (event: VoiceEvent) => {
    if (disposed) return;
    const { state: next, effect } = voiceStep(state, event);
    setState(next);
    switch (effect.type) {
      case "start":
        begin();
        break;
      case "stop":
        send(current, effect.durationMs);
        break;
      case "discard":
        end(current);
        if (effect.reason === "tooShort") deps.onNotice("tooShort");
        else deps.haptic?.("tap");
        break;
      case "abort":
        end(current);
        break;
      case "none":
        break;
    }
  };

  return {
    dispatch,
    state: () => state,
    level() {
      const rec = current && current.live && state.kind === "recording" ? current.rec : null;
      if (!rec) return 0;
      try {
        return rec.level();
      } catch {
        return 0;
      }
    },
    dispose() {
      if (disposed) return;
      // Leaving (thread switch, back to the keyboard) never sends.
      dispatch({ type: "interrupt" });
      end(current);
      disposed = true;
    },
  };
}

// Send-once for every send path (DataContext sendDirectVoice /
// sendRoundVoice, demo and real): a clip object is sent at most once, even
// if a page or a recorder callback hands it over twice.
const claimed = new WeakSet<VoiceClip>();
export function claimVoiceClip(clip: VoiceClip): boolean {
  if (claimed.has(clip)) return false;
  claimed.add(clip);
  return true;
}
