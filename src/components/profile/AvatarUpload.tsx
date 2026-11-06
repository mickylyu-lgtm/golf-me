import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { useLocale } from "../../i18n/LocaleContext";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { AVATAR_BUCKET, avatarPath, resizeImageToSquareBlob, uploadAvatarBlob } from "../../lib/avatarStorage";
import type { GolferProfile } from "../../types";
import { FullscreenMediaViewer } from "../community/FullscreenMediaViewer";
import { largestPhotoUrl } from "../../lib/providerPhoto";

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
  // May return the profile write; it's awaited so a failed save is shown
  // here instead of being lost, and a removed photo's file is only deleted
  // once the profile no longer points at it.
  onChange: (photoUrl: string | undefined) => void | Promise<unknown>;
  // Tells the parent an upload/remove is in flight (e.g. so onboarding's
  // Continue waits for the photo instead of saving without it).
  onBusyChange?: (busy: boolean) => void;
  size?: "lg" | "xl";
}

export function AvatarUpload({ golfer, onChange, onBusyChange, size = "xl" }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { t } = useLocale();
  const { isDemo, authUser } = useAuth();

  function setBusy(busy: boolean) {
    setLoading(busy);
    onBusyChange?.(busy);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || loading) return;
    if (!file.type.startsWith("image/")) {
      setError(t("avatarUpload.invalidFile"));
      return;
    }
    setBusy(true);
    setError(null);
    let photoUrl: string;
    try {
      // Real account: upload the actual bytes to Storage, never a
      // data-URL/base64 string into the database.
      photoUrl = !isDemo && authUser ? await uploadAvatarBlob(authUser.id, await resizeImageToSquareBlob(file)) : await resizeImageToSquareDataUrl(file);
    } catch {
      setError(t("avatarUpload.loadError"));
      setBusy(false);
      return;
    }
    try {
      await onChange(photoUrl);
    } catch (err) {
      console.error("GolfMe: failed to save the profile photo.", err);
      setError(t("avatarUpload.saveError"));
    } finally {
      setBusy(false);
    }
  }

  // The profile stops pointing at the photo FIRST; only then is the file
  // deleted. The other way round, a failed profile save left the profile
  // pointing at a deleted image.
  async function handleRemove() {
    if (loading) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(undefined);
    } catch (err) {
      console.error("GolfMe: failed to remove the profile photo.", err);
      setError(t("avatarUpload.saveError"));
      setBusy(false);
      return;
    }
    if (!isDemo && authUser) {
      const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(authUser.id)]);
      if (removeError) console.error("GolfMe: failed to remove avatar from storage.", removeError);
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3.5">
      {/* Tap your photo: see it fullscreen (pinch / double-tap zoom) before
          deciding to change it. No photo yet: the tap opens the picker. */}
      <button
        type="button"
        onClick={() => (golfer.photoUrl ? setViewerOpen(true) : inputRef.current?.click())}
        disabled={loading}
        aria-label={golfer.photoUrl ? t("avatarUpload.viewPhoto") : t("avatarUpload.addPhoto")}
        className={`relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 ${golfer.photoUrl ? "cursor-zoom-in" : ""}`}
      >
        <Avatar golfer={golfer} size={size} showVerified={false} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2 size={18} className="animate-spin text-white" />
          </div>
        )}
      </button>
      {viewerOpen && golfer.photoUrl && (
        <FullscreenMediaViewer
          media={[{ id: "own-avatar", type: "image", url: largestPhotoUrl(golfer.photoUrl) }]}
          onClose={() => setViewerOpen(false)}
          action={{
            label: t("avatarUpload.changePhoto"),
            onClick: () => {
              setViewerOpen(false);
              inputRef.current?.click();
            },
          }}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:border-fairway-300 hover:text-fairway-700 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fairway-400 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <ImagePlus size={13} /> {golfer.photoUrl ? t("avatarUpload.changePhoto") : t("avatarUpload.addPhoto")}
          </button>
          {golfer.photoUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors duration-200 hover:text-red-600 disabled:opacity-50"
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
