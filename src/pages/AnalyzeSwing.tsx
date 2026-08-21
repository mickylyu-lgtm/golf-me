import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, Video, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { captureVideoThumbnail, readVideoDuration } from "../lib/image";
import { supabase } from "../lib/supabase";

const COMMUNITY_MEDIA_BUCKET = "community-media"; // same bucket CreatePost.tsx's Swing Post upload uses — no second media pipeline
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit
const MAX_SWING_VIDEO_SECONDS = 30; // beta recommendation — short clips only, see analyze-swing's frame-sampling doc comment

// Direct-upload Caddie flow: pick a swing video, optionally label the club,
// get real Gemini feedback. Reuses the exact community-media Storage upload
// mechanics CreatePost.tsx already established for Swing Posts (same
// bucket, same path convention, same thumbnail capture) — no second media
// pipeline for what's conceptually the same "upload a swing video" action.
export function AnalyzeSwing() {
  const { createCaddieAnalysis, draftSwingVideo, setDraftSwingVideo } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const videoInputRef = useRef<HTMLInputElement>(null);

  // The video itself is backed by DataContext (mounted for the whole app
  // session), not local state — so a video picked here but not yet
  // submitted survives navigating away from this route and back instead of
  // being lost. The swing-type text stays local (seeded from any existing
  // draft) since it's trivial to retype and doesn't need the same guarantee
  // before a video has even been picked to attach it to.
  const videoFile = draftSwingVideo?.file;
  const videoPreviewUrl = draftSwingVideo?.previewUrl;
  const [swingType, setSwingTypeState] = useState(draftSwingVideo?.swingType ?? "");
  function setSwingType(next: string) {
    setSwingTypeState(next);
    if (videoFile && videoPreviewUrl) setDraftSwingVideo({ file: videoFile, previewUrl: videoPreviewUrl, swingType: next });
  }
  const [submitting, setSubmitting] = useState(false);

  if (isDemo || !authUser) {
    return (
      <div className="flex flex-col gap-5 pb-6">
        <button
          onClick={() => navigate("/caddie")}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {t("caddie.back")}
        </button>
        <EmptyState icon={<Video size={20} />} title={t("caddie.uploadSwing")} description={t("caddie.needsRealAccount")} />
      </div>
    );
  }

  async function handleVideoFile(e: ChangeEvent<HTMLInputElement>) {
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
    try {
      const duration = await readVideoDuration(file);
      if (duration > MAX_SWING_VIDEO_SECONDS) {
        showToast(t("caddie.videoTooLong"), "warning");
        return;
      }
    } catch {
      // Metadata read failing isn't itself disqualifying — the file-size
      // and format checks above already ran; let it through rather than
      // blocking a real, valid clip over a metadata quirk.
    }
    setDraftSwingVideo({ file, previewUrl: URL.createObjectURL(file), swingType });
  }

  function removeVideo() {
    setDraftSwingVideo(undefined);
  }

  async function handleAnalyze() {
    if (!videoFile || submitting || !authUser) return;
    setSubmitting(true);
    try {
      const path = `${authUser.id}/caddie-${crypto.randomUUID()}.${videoFile.name.split(".").pop() ?? "mp4"}`;
      const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, videoFile, { contentType: videoFile.type });
      if (uploadError) throw uploadError;
      const sourceMediaUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

      let thumbnailUrl: string | undefined;
      try {
        const thumbBlob = await captureVideoThumbnail(videoFile);
        const thumbPath = `${authUser.id}/caddie-thumb-${crypto.randomUUID()}.jpg`;
        const { error: thumbUploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
        if (!thumbUploadError) thumbnailUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(thumbPath).data.publicUrl;
      } catch (thumbErr) {
        console.error("Golf Me: failed to capture a video thumbnail.", thumbErr);
      }

      const created = await createCaddieAnalysis({
        sourceType: "direct_upload",
        sourceMediaUrl,
        thumbnailUrl,
        swingType: swingType.trim() || undefined,
      });
      setDraftSwingVideo(undefined);
      navigate(`/caddie/${created.id}`, { replace: true });
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.askCaddieError"), "warning");
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
        <h1 className="text-xl font-bold text-slate-900">{t("caddie.uploadSwing")}</h1>
      </div>

      {videoFile && videoPreviewUrl ? (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-fairway-200 bg-fairway-50/40 p-3">
          <div className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fairway-700">{videoFile.name}</span>
            <button onClick={removeVideo} className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
              <X size={12} /> {t("composer.remove")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => videoInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-10 text-slate-400 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-600"
        >
          <Video size={22} />
          <span className="text-sm font-semibold">{t("caddie.selectVideo")}</span>
          <span className="text-xs text-slate-400">{t("caddie.noVideoSelected")}</span>
        </button>
      )}
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />

      <div>
        <label className={labelClass}>{t("caddie.swingTypePlaceholder")}</label>
        <input value={swingType} onChange={(e) => setSwingType(e.target.value)} placeholder={t("caddie.swingTypePlaceholder")} className={inputClass} />
      </div>

      <Button
        size="lg"
        fullWidth
        disabled={!videoFile || submitting}
        onClick={handleAnalyze}
        icon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
      >
        {submitting ? t("caddie.analyzing") : t("caddie.askCaddie")}
      </Button>
    </div>
  );
}
