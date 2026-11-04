import { supabase } from "./supabase";

export const AVATAR_BUCKET = "avatars";

export function avatarPath(userId: string): string {
  return `${userId}/avatar.jpg`;
}

// Center-crops an image to a square, downsizes it and re-encodes it as a
// JPEG Blob. Real accounts upload these bytes to Supabase Storage rather
// than ever writing a data-URL/base64 string into the database.
export function resizeImageToSquareBlob(file: Blob, size = 320): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

// Uploads to the fixed per-user path (upsert) so "change photo" replaces in
// place rather than accumulating orphaned objects. The returned URL is
// cache-busted: the path is stable across replacements, so without a
// changing query param the browser/CDN would keep showing the old image.
export async function uploadAvatarBlob(userId: string, blob: Blob): Promise<string> {
  const path = avatarPath(userId);
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

// Copies a sign-in provider's picture (see providerPhoto.ts) into our own
// avatars bucket, so the profile doesn't depend on Google's URL staying
// valid and other golfers' devices never load an image from Google.
// Throws when the image can't be fetched (e.g. offline or CORS); callers
// fall back to the provider URL.
export async function copyPhotoToAvatar(userId: string, url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Photo fetch failed: ${res.status}`);
  const source = await res.blob();
  if (!source.type.startsWith("image/")) throw new Error("Photo is not an image");
  return uploadAvatarBlob(userId, await resizeImageToSquareBlob(source));
}
