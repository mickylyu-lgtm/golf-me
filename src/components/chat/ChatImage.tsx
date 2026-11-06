import { useState } from "react";
import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { chatImageDisplaySize, type ChatImageRef } from "../../lib/chatImages";
import { useChatImageUrl } from "../../lib/useChatImageUrl";

// A photo inside a chat bubble (DMs and round chat). The box is sized from
// the stored width/height before any pixel arrives (fixed width, CSS
// aspect-ratio, capped by the bubble), so a photo loading in never changes
// the list's height: the threads' near-bottom pinning and scroll position
// stay exactly as for text. The tiny stored placeholder shows blurred
// underneath until the photo itself has loaded.
//
// Tap opens the fullscreen viewer (the bubble's hold / swipe gestures swallow
// the click that ends them, so a hold or a swipe never also opens it).
// iOS's own image long-press callout (Save / Copy) is off: Copy is in the
// hold menu, which needs the hold.
export function ChatImage({
  image,
  localUrl,
  alt,
  openLabel,
  unavailableLabel,
  progress,
  onOpen,
}: {
  image: ChatImageRef;
  /** This device's own copy (sending, demo): shown without signing. */
  localUrl?: string | null;
  alt: string;
  openLabel: string;
  unavailableLabel: string;
  /** 0..1 while uploading; undefined once sent. */
  progress?: number;
  onOpen?: (url: string) => void;
}) {
  const { url, unavailable, onError, onLoad } = useChatImageUrl(image.path, localUrl);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const size = chatImageDisplaySize(image.width, image.height);
  const loaded = Boolean(url) && loadedUrl === url;
  const uploading = progress !== undefined;
  return (
    <button
      type="button"
      data-chat-image={image.path}
      aria-label={openLabel}
      // Never `disabled`: a disabled button swallows the pointer events the
      // bubble's hold gesture listens for.
      aria-disabled={!url || unavailable || uploading ? true : undefined}
      onClick={() => {
        if (url && !unavailable && !uploading) onOpen?.(url);
      }}
      className="relative block max-w-full overflow-hidden rounded-xl bg-slate-200 select-none [-webkit-touch-callout:none] aria-disabled:cursor-default"
      style={{ width: `${size.width}px`, aspectRatio: `${size.width} / ${size.height}` }}
    >
      {image.thumb && !loaded && (
        <img src={image.thumb} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />
      )}
      {url && !unavailable && (
        <img
          src={url}
          alt={alt}
          draggable={false}
          onLoad={() => {
            setLoadedUrl(url);
            onLoad();
          }}
          onError={onError}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {unavailable && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100/80 px-2 text-center text-[11px] font-medium text-slate-500">
          <ImageOff size={18} aria-hidden="true" />
          {unavailableLabel}
        </span>
      )}
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35" aria-hidden="true">
          <span className="relative h-10 w-10">
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0.04, Math.min(1, progress)) * 94.25} 94.25`}
                className="transition-[stroke-dasharray] duration-200 motion-reduce:transition-none"
              />
            </svg>
          </span>
        </span>
      )}
    </button>
  );
}

// A photo message's body inside its bubble: the photo, then the caption
// wrapped to the photo's width (so a long caption doesn't widen the bubble
// past the photo). The bubble's own quote, reaction pill etc. stay outside.
export function ChatPhotoBody({ caption, ...props }: Parameters<typeof ChatImage>[0] & { caption?: ReactNode }) {
  const size = chatImageDisplaySize(props.image.width, props.image.height);
  return (
    <div className="max-w-full" style={{ width: `${size.width}px` }}>
      <ChatImage {...props} />
      {caption ? <p className="px-2.5 pt-1.5 pb-1 [overflow-wrap:anywhere]">{caption}</p> : null}
    </div>
  );
}
