import { filmstripTimes } from "./trimWindow";

// Client-side only: reads a file, downsizes it (preserving aspect ratio —
// unlike AvatarUpload's square crop, post photos keep their natural shape),
// and re-encodes as a JPEG data URL. Demo mode's implementation — real
// accounts use resizeImageToBlob below and upload actual bytes to Supabase
// Storage instead.
export function resizeImageToDataUrl(file: File, maxDimension = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// Some real device-recorded video files never fire the browser events these
// two functions below depend on (loadedmetadata/seeked/error all silently
// never happening -- observed as a real, if intermittent, WebKit quirk on
// certain .mov encodings) -- without this, that hung the returned promise
// forever, which both call sites treat as "let it through"/"skip the
// thumbnail" on a caught rejection, but a promise that never settles at all
// isn't a rejection; it just permanently stalls whatever awaited it (Caddie
// upload's whole submit, in the duration-check case), looking exactly like
// "upload doesn't work" with no error to explain why (reported live).
const VIDEO_METADATA_TIMEOUT_MS = 8000;
function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), VIDEO_METADATA_TIMEOUT_MS))]);
}

// Nearly every pixel is black: a frame that wasn't decoded yet, or a fade-in.
function isMostlyBlack(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const px = ctx.getImageData(0, 0, w, h).data;
    let dark = 0;
    const total = px.length / 4;
    for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) <= 22) dark++;
    return dark >= total * 0.97;
  } catch {
    return false;
  }
}

// Captures a real frame from an actual uploaded video file as a JPEG blob —
// never a placeholder/fake image. Seeks a touch past frame 0 (some
// encoders leave the very first frame black), same idea as Instagram's own
// auto-thumbnail. Used only for the direct-upload Swing Post path; a video
// already sitting in Storage (Caddie's "Share to Community" handoff) isn't
// covered by this — see CreatePost.tsx's prefilledVideoUrl branch.
export function captureVideoThumbnail(file: File, maxDimension = 640, seekSeconds?: number): Promise<Blob> {
  return withTimeout(new Promise<Blob>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    function cleanup() {
      URL.revokeObjectURL(url);
    }

    // Candidate times, tried in order until one gives a frame that isn't
    // black: WebKit can fire `seeked` before the frame is decoded (preload
    // "metadata"), which drew a black thumbnail on iPhone and left the feed
    // card black with black blurred sides (reported live).
    let candidates: number[] = [];
    let attempt = 0;

    function seekNext() {
      const end = Math.max(0, (video.duration || 0) - 0.05);
      video.currentTime = Math.min(candidates[attempt], end || candidates[attempt]);
    }

    video.onloadedmetadata = () => {
      // A caller that trimmed a longer source video (VideoTrimSelector)
      // passes the trim's own start instead — grabbing a frame near 0
      // would otherwise show whatever preceded the actual analyzed swing.
      const first = seekSeconds ?? Math.min(0.3, (video.duration || 0.6) / 2);
      const d = video.duration || 0;
      candidates = [first, first + 0.7, d > 0 ? d / 2 : first + 1.5];
      seekNext();
    };

    function draw() {
      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        cleanup();
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (isMostlyBlack(ctx, canvas.width, canvas.height) && attempt < candidates.length - 1) {
        attempt++;
        seekNext();
        return;
      }
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error("Could not encode thumbnail"));
        },
        "image/jpeg",
        0.8,
      );
    }

    video.onseeked = () => {
      // Wait until the seeked frame is actually presented where the browser
      // can say so; a short timer otherwise (and as a backstop, since the
      // callback may never fire for a hidden, paused video).
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        draw();
      };
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      v.requestVideoFrameCallback?.(once);
      setTimeout(once, 250);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Could not load video"));
    };
  }), "Timed out reading video for a thumbnail");
}

// A row of real frames across the whole clip -- the "filmstrip"
// VideoTrimSelector draws its trim handles over, so the golfer can find the
// swing before picking the window. Sequential seeks on one hidden <video> (a
// canvas only ever holds the frame currently decoded).
//
// Reported live (2026-11-08): a playing preview above an almost-black track
// showing only "…". What the old version did that explains it: it resolved
// only once EVERY frame was drawn (nothing showed until the last one), it
// drew on `seeked`, which WebKit can fire before the frame is decoded (the
// same black-frame quirk captureVideoThumbnail works around), one seek that
// never landed held every frame back until a 20 s timeout and then left a
// bare track, and closing the trimmer did not stop it, so a stale decoder
// kept running beside the next one. Now frames arrive one by one
// (onFrame), every wait is bounded, a black frame is retried a little later
// and then left empty rather than shown black, and aborting tears the
// decoder down at once. Ten small JPEGs whatever the clip's length, so a
// long clip costs ten seeks, not more memory.
const FILMSTRIP_FRAME_TIMEOUT_MS = 4000;
const FILMSTRIP_TOTAL_TIMEOUT_MS = 25000;
// Several seeks in a row timing out means the decoder is stuck; stop early.
const FILMSTRIP_MAX_CONSECUTIVE_FAILURES = 3;

export interface FilmstripOptions {
  /** Abort to stop at once (a newer pick, the trimmer closing). */
  signal?: AbortSignal;
  maxHeightPx?: number;
  /** Each slot as it resolves: a JPEG data URL, or null when no usable frame came. */
  onFrame?: (index: number, src: string | null) => void;
  /** Used when the file's own metadata reports no finite duration. */
  fallbackDuration?: number;
  frameTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export async function generateVideoFilmstrip(file: Blob, count: number, options: FilmstripOptions = {}): Promise<(string | null)[]> {
  const {
    signal,
    maxHeightPx = 80,
    onFrame,
    fallbackDuration,
    frameTimeoutMs = FILMSTRIP_FRAME_TIMEOUT_MS,
    totalTimeoutMs = FILMSTRIP_TOTAL_TIMEOUT_MS,
  } = options;
  const frames: (string | null)[] = Array.from({ length: count }, () => null);
  if (signal?.aborted || count <= 0) return frames;
  const deadline = Date.now() + totalTimeoutMs;

  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  // Attached off screen rather than detached: WebKit decodes and paints
  // frames for an element in the document more dependably.
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;";
  const url = URL.createObjectURL(file);

  // Resolves true on `event`, false on error, abort or timeout (never hangs).
  function waitFor(event: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener(event, onEvent);
        video.removeEventListener("error", onFail);
        signal?.removeEventListener("abort", onFail);
        resolve(ok);
      };
      const onEvent = () => finish(true);
      const onFail = () => finish(false);
      const timer = setTimeout(onFail, Math.max(0, Math.min(ms, deadline - Date.now())));
      video.addEventListener(event, onEvent);
      video.addEventListener("error", onFail);
      signal?.addEventListener("abort", onFail);
    });
  }

  // Waits until the seeked frame is actually presented where the browser can
  // say so (requestVideoFrameCallback), with a short timer as the backstop.
  function framePresented(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      try {
        v.requestVideoFrameCallback?.(once);
      } catch {
        // Not available; the timer below covers it.
      }
      setTimeout(once, 250);
    });
  }

  try {
    document.body.appendChild(video);
    const metadata = waitFor("loadedmetadata", frameTimeoutMs * 2);
    video.src = url;
    if (!(await metadata)) {
      if (signal?.aborted) return frames;
      throw new Error("Could not load video for a filmstrip");
    }
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (fallbackDuration ?? 0);
    const times = filmstripTimes(duration, count);
    if (times.length === 0) throw new Error("Video has no usable duration");

    // iOS treats preload as a hint and may decode nothing until playback
    // starts; a muted inline play/pause gets the first frames decoded.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const played = video.play();
        await Promise.race([played, new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        // Autoplay refused; seeking below still decodes on most engines.
      }
      video.pause();
    }

    const scale = Math.min(1, maxHeightPx / (video.videoHeight || maxHeightPx));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxHeightPx) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxHeightPx) * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas not supported");

    let consecutiveFailures = 0;
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted || Date.now() >= deadline) break;
      let src: string | null = null;
      // The slot's time, then a little later if that frame came out black.
      for (const t of [times[i], Math.min(Math.max(0, duration - 0.05), times[i] + 0.2)]) {
        const seeked = waitFor("seeked", frameTimeoutMs);
        video.currentTime = t;
        if (!(await seeked)) break;
        await framePresented();
        if (signal?.aborted) break;
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          break;
        }
        if (!isMostlyBlack(ctx, canvas.width, canvas.height)) {
          src = canvas.toDataURL("image/jpeg", 0.6);
          break;
        }
      }
      if (signal?.aborted) break;
      consecutiveFailures = src ? 0 : consecutiveFailures + 1;
      frames[i] = src;
      onFrame?.(i, src);
      if (consecutiveFailures >= FILMSTRIP_MAX_CONSECUTIVE_FAILURES && !frames.some(Boolean)) break;
    }
    return frames;
  } finally {
    // Releases the decoder now, not whenever the element is collected.
    video.pause();
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // Already torn down.
    }
    video.remove();
    URL.revokeObjectURL(url);
  }
}

// Reads a video file's duration without uploading it — used to enforce
// Caddie's beta clip-length recommendation (see analyze-swing's frame-
// sampling doc comment: Gemini's Files API samples at a fixed ~1 FPS, so
// keeping clips short matters for actually covering the whole swing).
// Applied both to Swing Post uploads (CreatePost.tsx) and Caddie's
// direct-upload flow (AnalyzeSwing.tsx), since a Swing Post's video is
// exactly what Ask Caddie later runs on.
export function readVideoDuration(file: File): Promise<number> {
  return withTimeout(
    new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.src = url;
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read video metadata"));
      };
    }),
    "Timed out reading video duration",
  );
}

// Same downsize-and-encode as resizeImageToDataUrl but resolving a Blob —
// real accounts upload the actual bytes to Supabase Storage rather than
// ever writing a data-URL/base64 string into the database, same reasoning
// as AvatarUpload's resizeImageToSquareBlob.
export function resizeImageToBlob(file: File, maxDimension = 1400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
