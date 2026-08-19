import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Video } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { supabase } from "../lib/supabase";
import { captureVideoThumbnail } from "../lib/image";

const COMMUNITY_MEDIA_BUCKET = "community-media"; // reused, not duplicated — see RealCaddieContext/migration notes
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024;

// "Analyze a Swing" — the direct-upload half of Caddie. Reuses the exact
// upload mechanics CreatePost.tsx already established for Swing Posts
// (same bucket, same own-folder path convention, same size cap) rather
// than building a second media pipeline.
export function AnalyzeSwing() {
  const { createCaddieAnalysis } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoFile, setVideoFile] = useState<File | undefined>(undefined);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | undefined>(undefined);
  const [swingType, setSwingType] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      showToast(t("caddie.unsupportedVideo"), "warning");
      return;
    }
    if (file.size > MAX_SWING_VIDEO_BYTES) {
      showToast(t("caddie.videoTooLarge"), "warning");
      return;
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!videoFile || submitting) return;
    setSubmitting(true);
    try {
      let sourceMediaUrl = videoPreviewUrl ?? "";
      let thumbnailUrl: string | undefined;
      if (!isDemo && authUser) {
        const path = `${authUser.id}/caddie-${crypto.randomUUID()}.${videoFile.name.split(".").pop() ?? "mp4"}`;
        const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, videoFile, { contentType: videoFile.type });
        if (uploadError) throw uploadError;
        sourceMediaUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

        // Best-effort, same technique as CreatePost.tsx's Swing Post upload —
        // a real captured frame, never a placeholder, and never allowed to
        // block saving the analysis since the video itself already uploaded.
        try {
          const thumbBlob = await captureVideoThumbnail(videoFile);
          const thumbPath = `${authUser.id}/caddie-thumb-${crypto.randomUUID()}.jpg`;
          const { error: thumbUploadError } = await supabase.storage
            .from(COMMUNITY_MEDIA_BUCKET)
            .upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
          if (!thumbUploadError) {
            thumbnailUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(thumbPath).data.publicUrl;
          }
        } catch (thumbErr) {
          console.error("Golf Me: failed to capture a video thumbnail.", thumbErr);
        }
      }
      const created = await createCaddieAnalysis({
        sourceType: "direct_upload",
        sourceMediaUrl,
        thumbnailUrl,
        swingType: swingType.trim() || undefined,
      });
      showToast(t("caddie.savedToCaddie"), "success");
      navigate(`/caddie/${created.id}`, { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.couldNotSave"), "warning");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate("/caddie")}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> {t("caddie.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t("caddie.analyzeSwing")}</h1>
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-fairway-200 bg-fairway-50/30 p-4">
        {videoPreviewUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
        ) : (
          <p className="text-sm text-slate-500">{t("caddie.noVideoSelected")}</p>
        )}
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
        <Button variant="outline" icon={<Video size={15} />} onClick={() => fileInputRef.current?.click()}>
          {t("caddie.selectVideo")}
        </Button>
      </div>

      <input
        value={swingType}
        onChange={(e) => setSwingType(e.target.value)}
        placeholder={t("caddie.swingTypePlaceholder")}
        className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-fairway-400"
      />

      <Button size="lg" fullWidth disabled={!videoFile || submitting} onClick={handleSubmit} icon={submitting ? <Loader2 size={16} className="animate-spin" /> : undefined}>
        {t("caddie.analyzeSwing")}
      </Button>
    </div>
  );
}
