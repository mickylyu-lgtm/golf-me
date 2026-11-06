// Browser side of voice messages: microphone + MediaRecorder + a level
// meter. The rules (format choice, hold / cancel / 60 s) live in
// lib/chatVoice.ts. Nothing here uploads or transcribes anything: the
// recording stays a Blob on this device until the chat sends it to the
// private chat-media bucket.
import { canRecordVoice, pickVoiceMime } from "./chatVoice";

export interface VoiceClip {
  blob: Blob;
  durationMs: number;
  /** The recorder's own type, e.g. "audio/mp4" or "audio/webm;codecs=opus". */
  mime: string;
  /** Object URL of blob (this device's playback; revoked by its owner). */
  localUrl: string;
}

export class VoiceRecorderError extends Error {
  readonly reason: "denied" | "unavailable";
  constructor(reason: "denied" | "unavailable") {
    super(reason);
    this.reason = reason;
  }
}

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
  /** Stop and keep it. null if nothing usable was recorded. */
  stop(durationMs: number): Promise<VoiceClip | null>;
  /** Stop and throw it away. */
  discard(): void;
}

export async function startVoiceRecording(): Promise<ActiveRecording> {
  const mime = pickVoiceMime(isTypeSupported());
  if (!mime || !navigator.mediaDevices?.getUserMedia) throw new VoiceRecorderError("unavailable");
  // Made before the await, inside the press: WebKit only lets an
  // AudioContext run when it's created in a gesture.
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext | null = null;
  try {
    ctx = AC ? new AC() : null;
  } catch {
    ctx = null;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (err) {
    void ctx?.close().catch(() => {});
    const name = err && typeof err === "object" ? (err as { name?: string }).name : "";
    throw new VoiceRecorderError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
  }
  const release = () => {
    for (const t of stream.getTracks()) t.stop();
    void ctx?.close().catch(() => {});
  };
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
  } catch {
    release();
    throw new VoiceRecorderError("unavailable");
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  let analyser: AnalyserNode | null = null;
  let buffer: Uint8Array<ArrayBuffer> | null = null;
  if (ctx) {
    try {
      void ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      analyser = null;
    }
  }
  let done = false;

  return {
    level() {
      if (!analyser || !buffer) return 0;
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
    },
    stop(durationMs) {
      if (done) return Promise.resolve(null);
      done = true;
      return new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType || mime;
          const blob = new Blob(chunks, { type });
          resolve(blob.size > 0 ? { blob, durationMs, mime: type, localUrl: URL.createObjectURL(blob) } : null);
        };
        try {
          recorder.stop();
        } catch {
          release();
          resolve(null);
        }
      });
    },
    discard() {
      if (done) return;
      done = true;
      recorder.onstop = () => release();
      try {
        recorder.stop();
      } catch {
        release();
      }
    },
  };
}
