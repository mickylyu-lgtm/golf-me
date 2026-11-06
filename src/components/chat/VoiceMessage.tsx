import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { formatVoiceDuration, voiceBubbleWidth, type ChatVoiceRef } from "../../lib/chatVoice";
import { useChatImageUrl } from "../../lib/useChatImageUrl";

// One voice message inside its bubble: play / pause, a progress bar and the
// length. The width grows with the length (WeChat) and is fixed from the
// stored duration, so nothing moves while it loads or plays. Audio comes
// from the same in-memory signed-URL cache as photos (private chat-media);
// a local copy (this device's own, demo) plays without signing.
// Only one voice message plays at a time.
let playing: HTMLAudioElement | null = null;

export function VoiceMessage({
  voice,
  localUrl,
  isMe,
  progress,
  labels,
}: {
  voice: ChatVoiceRef;
  localUrl?: string | null;
  isMe: boolean;
  /** 0..1 while uploading. */
  progress?: number;
  labels: { play: string; pause: string; unavailable: string; unsupported: string };
}) {
  const { url, unavailable, onError, onLoad } = useChatImageUrl(voice.path, localUrl);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [unsupported, setUnsupported] = useState(false);
  const uploading = progress !== undefined;

  useEffect(
    () => () => {
      if (playing === audioRef.current) playing = null;
    },
    [],
  );

  function toggle() {
    const a = audioRef.current;
    if (!a || !url || unavailable || unsupported || uploading) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (playing && playing !== a) playing.pause();
    playing = a;
    void a.play().catch(() => setIsPlaying(false));
  }

  const fraction = uploading ? Math.max(0.04, Math.min(1, progress ?? 0)) : voice.durationMs > 0 ? Math.min(1, (position * 1000) / voice.durationMs) : 0;
  const shownMs = isPlaying || position > 0 ? position * 1000 : voice.durationMs;
  const broken = unavailable || unsupported;
  return (
    <div
      data-voice-message={voice.path}
      className="flex items-center gap-2.5 px-2.5 py-1.5 select-none [-webkit-touch-callout:none]"
      style={{ width: `${voiceBubbleWidth(voice.durationMs)}px`, maxWidth: "100%" }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? labels.pause : labels.play}
        aria-disabled={!url || broken || uploading ? true : undefined}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isMe ? "bg-white/20 text-white" : "bg-white text-fairway-700"} aria-disabled:opacity-60`}
      >
        {uploading ? (
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : isPlaying ? (
          <Pause size={15} aria-hidden="true" />
        ) : (
          <Play size={15} className="translate-x-px" aria-hidden="true" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className={`h-1 overflow-hidden rounded-full ${isMe ? "bg-white/30" : "bg-slate-300"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div data-voice-progress className={`h-full rounded-full ${isMe ? "bg-white" : "bg-fairway-600"}`} style={{ width: `${fraction * 100}%` }} />
        </div>
        <span className={`text-[11px] tabular-nums ${isMe ? "text-white/85" : "text-slate-500"}`}>
          {broken ? (unsupported ? labels.unsupported : labels.unavailable) : formatVoiceDuration(Math.min(shownMs, voice.durationMs))}
        </span>
      </div>
      {url && !broken && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={onLoad}
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            // A WebM/Opus recording on an iPhone that can't decode it: no retry.
            if (code === 4 && voice.path.endsWith(".webm") && /iPhone|iPad|iPod/.test(navigator.userAgent)) setUnsupported(true);
            else onError();
          }}
        />
      )}
    </div>
  );
}
