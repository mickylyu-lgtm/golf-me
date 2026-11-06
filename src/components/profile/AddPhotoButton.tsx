import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { resizeImageToSquareBlob, uploadAvatarBlob } from "../../lib/avatarStorage";
import { resizeImageToSquareDataUrl } from "./AvatarUpload";

// The same photo picker + resize/upload path as AvatarUpload (Profile), as a
// compact inline button for places that only need "add a photo" (Reputation's
// Verified Golfer steps). Real accounts upload to Storage; demo keeps a data
// URL locally, exactly like AvatarUpload.
export function AddPhotoButton({
  onChange,
  className,
  children,
}: {
  onChange: (photoUrl: string) => void | Promise<unknown>;
  className: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    if (!file.type.startsWith("image/")) {
      showToast(t("avatarUpload.invalidFile"), "warning");
      return;
    }
    setBusy(true);
    try {
      let photoUrl: string;
      try {
        photoUrl = !isDemo && authUser ? await uploadAvatarBlob(authUser.id, await resizeImageToSquareBlob(file)) : await resizeImageToSquareDataUrl(file);
      } catch {
        showToast(t("avatarUpload.loadError"), "warning");
        return;
      }
      try {
        await onChange(photoUrl);
      } catch (err) {
        console.error("GolfMe: failed to save the profile photo.", err);
        showToast(t("avatarUpload.saveError"), "warning");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} data-testid="verified-add-photo-input" />
    </>
  );
}
