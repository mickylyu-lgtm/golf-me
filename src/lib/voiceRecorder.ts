// Browser side of voice messages: microphone + MediaRecorder + a level
// meter. The rules (format choice, hold / cancel / 60 s) live in
// lib/chatVoice.ts, which attempt owns the microphone in
// lib/voiceSession.ts. Nothing here uploads or transcribes anything: the
// recording stays a Blob on this device until the chat sends it to the
// private chat-media bucket.
//
// Resources: everything one call acquires (the AudioContext, the
// microphone stream's tracks, the MediaRecorder and its callbacks) is
// released by ONE idempotent release(), on every way out: getUserMedia
// rejecting, the attempt being aborted while the permission prompt was up,
// the recorder constructor or start() throwing, stop(), discard(), and a
// stop() whose onstop never comes (STOP_WATCHDOG_MS).
import { canRecordVoice, pickVoiceMime } from "./chatVoice.ts";

export interface VoiceClip {
  blob: Blob;
  durationMs: number;
  /** The recorder's own type, e.g. "audio/mp4" or "audio/webm;codecs=opus". */
  mime: string;
  /** Object URL of blob (this device's playback; revoked by its owner). */
  localUrl: string;
}

/** "aborted" = the attempt was given up (release / cancel / a newer hold) before it got the microphone. */
export type VoiceRecorderErrorReason = "denied" | "unavailable" | "aborted";

export class VoiceRecorderError extends Error {
  readonly reason: VoiceRecorderErrorReason;
  constructor(reason: VoiceRecorderErrorReason) {
    super(reason);
    this.reason = reason;
  }
}

/** stop() gives up waiting for the recorder's onstop after this long: the microphone is released and nothing is sent. */
export const STOP_WATCHDOG_MS = 4000;

function isTypeSupported(): ((t: string) => boolean) | null {
  const MR = typeof window !== "undefined" ? (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder : undefined;
  return MR && typeof MR.isTypeSupported === "function" ? (t) => MR.isTypeSupported!(t) : null;
}

/**
 * The mic button shows only when this is true: getUserMedia + MediaRecorder
 * + a recordable audio type. In the iOS app that means iOS 14.5+ WKWebView
 * (Info.plist NSMicrophoneUsageDescription is already present); a denied
 * permission is reported when the golfer first holds the bar.
 */
export function voiceRecordingAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return canRecordVoice({
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    mediaRecorder: typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === "function",
    isTypeSupported: isTypeSupported(),
  });
}

export interface ActiveRecording {
  /** 0..1 loudness right now, for the meter. */
  level(): number;
  /** Stop and keep it. null if nothing usable was recorded. Resolves once; later calls resolve null. */
  stop(durationMs: number): Promise<VoiceClip | null>;
  /** Stop and throw it away (releases the microphone now). Idempotent. */
  discard(): void;
}

function quietly(fn: () => unknown) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
  } catch {
    // Cleanup never throws.
  }
}

export async function startVoiceRecording(options: { signal?: AbortSignal } = {}): Promise<ActiveRecording> {
  const { signal } = options;
  const mime = pickVoiceMime(isTypeSupported());
  if (!mime || !navigator.mediaDevices?.getUserMedia) throw new VoiceRecorderError("unavailable");
  if (signal?.aborted) throw new VoiceRecorderError("aborted");

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let released = false;
  // Idempotent and unconditional: every track of this call's stream, this
  // call's AudioContext, the recorder's callbacks. Never anyone else's.
  const release = () => {
    if (released) return;
    released = true;
    const r = recorder;
    if (r) {
      r.ondataavailable = null;
      r.onstop = null;
      r.onerror = null;
      quietly(() => {
        if (r.state !== "inactive") r.stop();
      });
    }
    if (stream) for (const t of stream.getTracks()) quietly(() => t.stop());
    const c = ctx;
    if (c) quietly(() => c.close());
  };

  // Made before the await, inside the press: WebKit only lets an
  // AudioContext run when it's created in a gesture.
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    ctx = AC ? new AC() : null;
  } catch {
    ctx = null;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (err) {
    release();
    const name = err && typeof err === "object" ? (err as { name?: string }).name : "";
    throw new VoiceRecorderError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
  }
  // The microphone answered after this attempt was given up (released, a
  // newer hold, the thread closed, the app hidden): its own tracks and
  // context go, nothing else is touched.
  if (signal?.aborted) {
    release();
    throw new VoiceRecorderError("aborted");
  }

  const chunks: Blob[] = [];
  try {
    const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
    recorder = r;
    r.ondataavailable = (e) => {
      if (!released && e.data && e.data.size > 0) chunks.push(e.data);
    };
    r.start(250);
  } catch {
    release();
    throw new VoiceRecorderError("unavailable");
  }
  const rec = recorder as MediaRecorder;

  let analyser: AnalyserNode | null = null;
  let buffer: Uint8Array<ArrayBuffer> | null = null;
  const meterCtx = ctx;
  if (meterCtx) {
    try {
      quietly(() => meterCtx.resume());
      const source = meterCtx.createMediaStreamSource(stream);
      analyser = meterCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      // No meter; the recording itself is fine.
      analyser = null;
    }
  }
  let done = false;

  return {
    level() {
      if (released || !analyser || !buffer) return 0;
      try {
        analyser.getByteTimeDomainData(buffer);
      } catch {
        return 0;
      }
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
    },
    stop(durationMs) {
      if (done || released) {
        done = true;
        release();
        return Promise.resolve(null);
      }
      done = true;
      return new Promise((resolve) => {
        let settled = false;
        let watchdog: ReturnType<typeof setTimeout> | null = null;
        const finish = (clip: VoiceClip | null) => {
          if (settled) return;
          settled = true;
          if (watchdog !== null) clearTimeout(watchdog);
          release();
          resolve(clip);
        };
        rec.onstop = () => {
          if (settled) return;
          const type = rec.mimeType || mime;
          const blob = new Blob(chunks, { type });
          finish(blob.size > 0 ? { blob, durationMs, mime: type, localUrl: URL.createObjectURL(blob) } : null);
        };
        rec.onerror = () => finish(null);
        watchdog = setTimeout(() => finish(null), STOP_WATCHDOG_MS);
        try {
          if (rec.state === "inactive") finish(null);
          else rec.stop();
        } catch {
          finish(null);
        }
      });
    },
    discard() {
      done = true;
      chunks.length = 0;
      release();
    },
  };
}
