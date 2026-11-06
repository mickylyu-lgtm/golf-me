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
//
// Privacy (where a clip goes): every attempt captures its conversation (its
// VoiceOrigin) and a recording id AT PRESS TIME, and the delivered clip
// carries both, frozen. The send paths take the destination only from
// clip.origin (claimVoiceSend), never from whichever thread is on screen
// when the recorder finally answers: a page reused for B (a notification /
// deep link while A's stop(), upload or send is pending) can't receive A's
// clip. Policy (Micky, 2026-11-06): a released clip finishes in ITS OWN
// conversation even if the golfer has left it; a clip still being recorded
// when the conversation changes is cancelled (originChanged / dispose).
import { voiceStep, type VoiceEvent, type VoiceState } from "./chatVoice.ts";
import type { ActiveRecording, VoiceClip, VoiceRecorderErrorReason } from "./voiceRecorder.ts";

export type VoiceNotice = "denied" | "unavailable" | "tooShort" | "failed";
export type VoiceHaptic = "medium" | "success" | "tap";

/** The conversation a recording belongs to: a DM (the other golfer's id) or a round chat (the round id). */
export interface VoiceOrigin {
  readonly kind: "dm" | "round";
  readonly id: string;
}

/** A delivered clip, bound to the conversation and recording it came from. */
export type SentVoiceClip = VoiceClip & {
  /** null only when the session was made without an origin (tests); the send paths refuse it. */
  readonly origin: VoiceOrigin | null;
  readonly recordingId: string;
};

export function sameVoiceOrigin(a: VoiceOrigin | null | undefined, b: VoiceOrigin | null | undefined): boolean {
  return Boolean(a && b && a.kind === b.kind && a.id === b.id);
}

let recordingSeq = 0;
const newRecordingId = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : `rec-${Date.now()}-${++recordingSeq}`;
};

export interface VoiceSessionDeps {
  /** Acquire the microphone + recorder for one attempt (lib/voiceRecorder.ts startVoiceRecording). */
  start(signal: AbortSignal): Promise<ActiveRecording>;
  /** The conversation on screen; read once per press and kept by that attempt. */
  origin?(): VoiceOrigin | null;
  onState(state: VoiceState): void;
  onClip(clip: SentVoiceClip): void;
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
  /**
   * The conversation on screen changed (deps.origin() now answers another
   * one): a recording still being held for the old one is cancelled, never
   * sent. Released clips are untouched; they finish in their own origin.
   */
  originChanged(): void;
  /** Unmount: ends any attempt (never sends one still being held); later events are ignored. */
  dispose(): void;
}

interface Attempt {
  id: number;
  abort: AbortController;
  live: boolean;
  rec: ActiveRecording | null;
  readonly origin: VoiceOrigin | null;
  readonly recordingId: string;
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
    const o = deps.origin?.() ?? null;
    const attempt: Attempt = {
      id: ++nextId,
      abort: new AbortController(),
      live: true,
      rec: null,
      origin: o ? Object.freeze({ kind: o.kind, id: o.id }) : null,
      recordingId: newRecordingId(),
    };
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
    if (!rec || !a) return;
    // Bound now, from the attempt (captured at its press), never re-read.
    const origin = a.origin;
    const recordingId = a.recordingId;
    deps.haptic?.("success");
    let delivered = false;
    rec.stop(durationMs).then(
      (clip) => {
        if (delivered) {
          if (clip) deps.revokeUrl?.(clip.localUrl);
          return;
        }
        delivered = true;
        if (clip) deps.onClip(Object.freeze({ ...clip, origin, recordingId }));
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
    originChanged() {
      if (disposed || !current || !current.live) return;
      if (sameVoiceOrigin(current.origin, deps.origin?.() ?? null)) return;
      // Held (or still waiting for the microphone) for the conversation the
      // golfer just left: cancelled, exactly like the app going to the
      // background.
      dispatch({ type: "interrupt" });
      end(current);
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

export type VoiceSendClaim = { ok: true; to: string } | { ok: false; reason: "duplicate" | "noOrigin" };

/**
 * The send boundary (DataContext sendDirectVoice / sendRoundVoice): the
 * destination is the clip's own origin, of the expected kind, or nothing.
 * A clip without an origin (or a DM clip handed to the round path) is
 * refused without being claimed; a repeat of an already-claimed clip is a
 * duplicate.
 */
export function claimVoiceSend(clip: SentVoiceClip, kind: VoiceOrigin["kind"]): VoiceSendClaim {
  const origin = clip.origin;
  if (!origin || origin.kind !== kind || !origin.id) return { ok: false, reason: "noOrigin" };
  if (!claimVoiceClip(clip)) return { ok: false, reason: "duplicate" };
  return { ok: true, to: origin.id };
}

/**
 * How a thread page sends a delivered clip. The destination is always the
 * clip's origin. The reply quote (and clearing the reply bar) is taken from
 * the page only when the page still shows that same conversation; a clip
 * from A finishing while B is on screen goes to A without a quote and
 * leaves B's composer alone. null = not this page's kind (never sent).
 */
export function voiceSendPlan(
  clip: SentVoiceClip,
  kind: VoiceOrigin["kind"],
  page: { id: string | null | undefined; replyToId: string | null | undefined },
): { to: string; here: boolean; replyToId: string | null } | null {
  const origin = clip.origin;
  if (!origin || origin.kind !== kind || !origin.id) return null;
  const here = Boolean(page.id) && page.id === origin.id;
  return { to: origin.id, here, replyToId: here ? (page.replyToId ?? null) : null };
}
