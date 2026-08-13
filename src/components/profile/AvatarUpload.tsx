import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { useLocale } from "../../i18n/LocaleContext";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import type { GolferProfile } from "../../types";

const AVATAR_BUCKET = "avatars";

// Same square-crop-and-downsize as the data-URL path below, but resolving a
// Blob instead of a string — real accounts upload the actual bytes to
// Supabase Storage rather than ever writing a data-URL/base64 string into
// the database.
function resizeImageToSquareBlob(file: File, size = 320): Promise<Blob> {
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

// Client-side only: reads the file, center-crops it to a square, downsizes
// it, and re-encodes as a JPEG data URL. Keeps localStorage lean without
// needing any upload endpoint. Swap for real object storage (e.g. Supabase
// Storage) later — callers only ever see a string URL either way.
function resizeImageToSquareDataUrl(file: File, size = 320): Promise<string> {
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
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

interface AvatarUploadProps {
  golfer: Pick<GolferProfile, "avatarColor" | "avatarInitials" | "verification" | "photoUrl">;
  onChange: (photoUrl: string | undefined) => void;
  size?: "lg" | "xl";
}

export function AvatarUpload({ golfer, onChange, size = "xl" }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useLocale();
  const { isDemo, authUser } = useAuth();

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("avatarUpload.invalidFile"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!isDemo && authUser) {
        // Real account: upload the actual bytes to Storage, never a
        // data-URL/base64 string into the database. Fixed path per user
        // (upsert) so "change photo" replaces in place rather than
        // accumulating orphaned objects.
        const blob = await resizeImageToSquareBlob(file);
        const path = `${authUser.id}/avatar.jpg`;
        const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
        // Cache-bust: the path is stable across replacements, so without a
        // changing query param the browser/CDN would keep showing the old
        // image after a "change photo".
        onChange(`${data.publicUrl}?t=${Date.now()}`);
      } else {
        const dataUrl = await resizeImageToSquareDataUrl(file);
        onChange(dataUrl);
      }
    } catch {
      setError(t("avatarUpload.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    if (!isDemo && authUser) {
      const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([`${authUser.id}/avatar.jpg`]);
      if (removeError) console.error("Golf Me: failed to remove avatar from storage.", removeError);
    }
    onChange(undefined);
  }

  return (
    <div className="flex items-center gap-3.5">
      <div className="relative">
        <Avatar golfer={golfer} size={size} showVerified={false} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2 size={18} className="animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2"
          >
            <ImagePlus size={13} /> {golfer.photoUrl ? t("avatarUpload.changePhoto") : t("avatarUpload.addPhoto")}
          </button>
          {golfer.photoUrl && (
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors duration-200 hover:text-red-600"
            >
              <X size={13} /> {t("avatarUpload.remove")}
            </button>
          )}
        </div>
        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : (
          <p className="text-xs text-slate-400">{golfer.photoUrl ? t("avatarUpload.hasPhotoHelp") : t("avatarUpload.noPhotoHelp")}</p>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}
