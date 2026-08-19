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

// Captures a real frame from an actual uploaded video file as a JPEG blob —
// never a placeholder/fake image. Seeks a touch past frame 0 (some
// encoders leave the very first frame black), same idea as Instagram's own
// auto-thumbnail. Used only for the direct-upload Swing Post path; a video
// already sitting in Storage (Caddie's "Share to Community" handoff) isn't
// covered by this — see CreatePost.tsx's prefilledVideoUrl branch.
export function captureVideoThumbnail(file: File, maxDimension = 640): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    function cleanup() {
      URL.revokeObjectURL(url);
    }

    video.onloadedmetadata = () => {
      const seekTime = Math.min(0.3, (video.duration || 0.6) / 2);
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error("Could not encode thumbnail"));
        },
        "image/jpeg",
        0.8,
      );
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Could not load video"));
    };
  });
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
