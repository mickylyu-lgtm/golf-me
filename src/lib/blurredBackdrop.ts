import { useEffect, useState } from "react";

// A soft, pre-blurred copy of an image, as a tiny data URL. Shrinking the
// image to a few pixels and letting the browser stretch it back up looks like
// a heavy blur but costs nothing per frame, unlike a CSS `filter: blur()`,
// which WebKit re-rasterizes for every card as it scrolls into view and made
// the Community feed stutter on iPhone.

const SMALL = 8; // pixels on the long side: the "blur radius"
const OUT = 48; // smoothed back up once so the stretch has no visible blocks
const cache = new Map<string, string | null>();

function build(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const scale = SMALL / Math.max(img.naturalWidth, img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const small = document.createElement("canvas");
        small.width = w;
        small.height = h;
        small.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const out = document.createElement("canvas");
        out.width = Math.round((OUT * w) / Math.max(w, h));
        out.height = Math.round((OUT * h) / Math.max(w, h));
        const ctx = out.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(small, 0, 0, out.width, out.height);
        resolve(out.toDataURL("image/jpeg", 0.7));
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

export function useBlurredBackdrop(url: string | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(() => (url ? (cache.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) return setDataUrl(null);
    if (cache.has(url)) return setDataUrl(cache.get(url) ?? null);
    let live = true;
    void build(url).then((result) => {
      cache.set(url, result);
      if (live) setDataUrl(result);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return dataUrl;
}
