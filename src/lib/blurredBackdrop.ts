import { useEffect, useState } from "react";
import type React from "react";

// A soft, pre-blurred copy of an image, as a tiny data URL. Shrinking the
// image to a few pixels and letting the browser stretch it back up looks like
// a heavy blur but costs nothing per frame, unlike a CSS `filter: blur()`,
// which WebKit re-rasterizes for every card as it scrolls into view and made
// the Community feed stutter on iPhone.
//
// Some swing videos have black bars baked into the picture itself (exported
// from an editing or social app as a square/4:5 frame). Those bars are part
// of the frames, so sizing the <video> box to its picture can't remove them.
// The same thumbnail is scanned for solid-black edges; the caller clips them
// off the video, and the backdrop is built from the real picture only so the
// bars don't bleed into the blur.

const SMALL = 8; // pixels on the long side: the "blur radius"
const OUT = 48; // smoothed back up once so the stretch has no visible blocks
const SCAN = 96; // pixels on the long side for the black-bar scan
const BAR_MAX = 22; // brightest channel a "black" bar pixel may have (0-255)
const BAR_SHARE = 0.97; // share of a row/column that must be black to count as bar
const MIN_BAR = 0.03; // ignore bars thinner than this share of the frame
const MIN_CONTENT = 0.3; // never crop down to less than this share of the frame

/** Fractions (0-1) of the frame taken by baked-in black bars on each side. */
export interface BarInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BlurredBackdrop {
  src: string;
  bars: BarInsets | null;
  aspect: number; // width / height of the whole frame, bars included
}

const cache = new Map<string, BlurredBackdrop | null>();

export function findBars(img: HTMLImageElement): BarInsets | null {
  const scale = SCAN / Math.max(img.naturalWidth, img.naturalHeight, 1);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const dark = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return Math.max(px[i], px[i + 1], px[i + 2]) <= BAR_MAX;
  };
  const colBar = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) if (dark(x, y)) n++;
    return n >= h * BAR_SHARE;
  };
  const rowBar = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (dark(x, y)) n++;
    return n >= w * BAR_SHARE;
  };
  let left = 0;
  while (left < w && colBar(left)) left++;
  let right = 0;
  while (right < w - left && colBar(w - 1 - right)) right++;
  let top = 0;
  while (top < h && rowBar(top)) top++;
  let bottom = 0;
  while (bottom < h - top && rowBar(h - 1 - bottom)) bottom++;
  // One extra scan pixel inward hides the soft dark edge the video encoder
  // leaves where a bar meets the picture.
  const side = (n: number, size: number) => (n / size >= MIN_BAR ? Math.min(1, (n + 1) / size) : 0);
  const bars = { top: side(top, h), right: side(right, w), bottom: side(bottom, h), left: side(left, w) };
  if (1 - bars.left - bars.right < MIN_CONTENT || 1 - bars.top - bars.bottom < MIN_CONTENT) return null; // a dark shot, not bars
  return bars.top || bars.right || bars.bottom || bars.left ? bars : null;
}

export function buildBlurredBackdrop(url: string): Promise<BlurredBackdrop | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const bars = findBars(img);
        const sx = (bars?.left ?? 0) * img.naturalWidth;
        const sy = (bars?.top ?? 0) * img.naturalHeight;
        const sw = Math.max(1, img.naturalWidth * (1 - (bars?.left ?? 0) - (bars?.right ?? 0)));
        const sh = Math.max(1, img.naturalHeight * (1 - (bars?.top ?? 0) - (bars?.bottom ?? 0)));
        const scale = SMALL / Math.max(sw, sh, 1);
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const small = document.createElement("canvas");
        small.width = w;
        small.height = h;
        small.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        const out = document.createElement("canvas");
        out.width = Math.round((OUT * w) / Math.max(w, h));
        out.height = Math.round((OUT * h) / Math.max(w, h));
        const ctx = out.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(small, 0, 0, out.width, out.height);
        resolve({ src: out.toDataURL("image/jpeg", 0.7), bars, aspect: img.naturalWidth / Math.max(img.naturalHeight, 1) });
      } catch {
        resolve(null); // tainted canvas (no CORS): caller falls back to a flat colour
      }
    };
    img.onerror = () => resolve(null);
    // Separate cache entry from the <video poster> load, which isn't a CORS
    // request; reusing that cached response would taint the canvas.
    img.src = `${url}${url.includes("?") ? "&" : "?"}backdrop=1`;
  });
}

export function useBlurredBackdrop(url: string | undefined): BlurredBackdrop | null {
  const [backdrop, setBackdrop] = useState<BlurredBackdrop | null>(() => (url ? (cache.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) return setBackdrop(null);
    if (cache.has(url)) return setBackdrop(cache.get(url) ?? null);
    let live = true;
    void buildBlurredBackdrop(url).then((result) => {
      cache.set(url, result);
      if (live) setBackdrop(result);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return backdrop;
}

/** CSS clip-path that hides baked-in bars, or undefined when there are none. */
export function barsClipPath(bars: BarInsets | null | undefined): string | undefined {
  if (!bars) return undefined;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  return `inset(${pct(bars.top)} ${pct(bars.right)} ${pct(bars.bottom)} ${pct(bars.left)})`;
}

/** findBars for an image already on screen; null when it can't be read (no CORS). */
export function safeFindBars(img: HTMLImageElement): BarInsets | null {
  try {
    return findBars(img);
  } catch {
    return null;
  }
}

/**
 * Inline style that zooms media filling a fixed box (object-cover style) so
 * its baked-in bars fall outside the box. The box must be `position:
 * relative; overflow: hidden; container-type: size` (see BarCropBox).
 */
export function barsCoverStyle(bars: BarInsets, aspect: number): React.CSSProperties {
  const cw = 1 - bars.left - bars.right;
  const ch = 1 - bars.top - bars.bottom;
  return {
    ["--dw" as string]: `max(calc(100cqw / ${cw}), calc(100cqh * ${aspect} / ${ch}))`,
    position: "absolute",
    width: "var(--dw)",
    height: `calc(var(--dw) / ${aspect})`,
    maxWidth: "none",
    objectFit: "fill",
    left: `calc(50cqw - var(--dw) * ${bars.left + cw / 2})`,
    top: `calc(50cqh - var(--dw) / ${aspect} * ${bars.top + ch / 2})`,
  };
}
