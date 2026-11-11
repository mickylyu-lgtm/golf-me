import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Scissors, ScanLine, Video, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ClubPicker } from "../components/caddie/ClubPicker";
import { VideoTrimSelector } from "../components/caddie/VideoTrimSelector";
import { FilmingTips } from "../components/caddie/FilmingTips";
import { captureVideoThumbnail, readVideoDuration } from "../lib/image";
import { analysisBlocker, canStartAnalysis, createTrimReopenGate, resolveTrimReopen } from "../lib/trimReopen";
import { formatClock } from "../lib/format";
import { supabase } from "../lib/supabase";
import { CADDIE_MEDIA_BUCKET } from "../lib/caddieMedia";
import { CaddieRequestError } from "../lib/caddieAnalysis";
import { isCatalogClub, restoredDraftClub } from "../lib/clubCatalog";
import { caddieErrorText } from "../lib/caddieErrorText";
import { isInMemoryPick, pickMedia } from "../lib/mediaPicker";
import { createVideoSelectionGate, prepareVideoSelection, videoPickRejection } from "../lib/videoSelection";
import { caddieDurationRejection, MAX_CADDIE_UPLOAD_SECONDS } from "../lib/caddieUploadLimit";
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit
const MAX_SWING_VIDEO_SECONDS = MAX_CADDIE_UPLOAD_SECONDS; // whole source, not only a selected window
// Once analyze-swing actually creates the 'processing' row, the real
// analysis runs server-side (EdgeRuntime.waitUntil) independent of this
// app staying open — closing the app doesn't stop it. The one real gap is
// the upload-and-start-analysis call ITSELF: if the app is killed mid
// upload (reported live as "it shouldn't just disappear"), no row is ever
// created, and there was no trace afterward that anything had been
// attempted. This flag brackets that exact window so a golfer who reopens
// the app after an interruption gets an honest "that didn't finish, try
// again" instead of silence that reads as data loss.
const UPLOAD_IN_PROGRESS_KEY = "golfme:caddieUploadInProgress";

// "Choose a club to continue" under Ask Caddie, tied to it by aria-describedby.
const CLUB_REQUIRED_HINT_ID = "caddie-club-required-hint";

// The club choice: a fixed set (ClubPicker over lib/clubCatalog.ts), not
// free typing. English values (caddie_analyses.swing_type), translated for
// display by clubLabel(); no Putter, see clubCatalog.ts.

// Direct-upload Caddie flow: pick a swing video, optionally label the club,
// get real Gemini feedback. Same upload mechanics as CreatePost.tsx's Swing
// Posts (same `<uid>/<file>` path convention, same thumbnail capture), but
// into the PRIVATE caddie-media bucket (migration 20260925090000): a Caddie
// upload stays private unless the golfer explicitly shares it, and then
// CreatePost copies it into public community-media at publish time.
export function AnalyzeSwing() {
  const { createCaddieAnalysis, draftSwingVideo, setDraftSwingVideo } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLocale();
  const navigate = useNavigate();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // The video itself is backed by DataContext (mounted for the whole app
  // session), not local state — so a video picked here but not yet
  // submitted survives navigating away from this route and back instead of
  // being lost. The swing-type text stays local (seeded from any existing
  // draft) since it's trivial to retype and doesn't need the same guarantee
  // before a video has even been picked to attach it to.
  const videoFile = draftSwingVideo?.file;
  const videoPreviewUrl = draftSwingVideo?.previewUrl;
  // Every older picker value is still in the catalog (isCatalogClub); a
  // draft holding anything else (Putter, from before it was removed, or any
  // unknown string) falls back to "" and so reads as "no club yet".
  const [swingType, setSwingTypeState] = useState(() => restoredDraftClub(draftSwingVideo?.swingType));
  // Only a club the picker offers counts as picked (never a stale value).
  const hasClub = isCatalogClub(swingType);
  function setSwingType(next: string) {
    setSwingTypeState(next);
    if (videoFile && videoPreviewUrl) {
      setDraftSwingVideo({
        file: videoFile,
        previewUrl: videoPreviewUrl,
        swingType: next,
        trimStartSeconds: draftSwingVideo?.trimStartSeconds,
        trimEndSeconds: draftSwingVideo?.trimEndSeconds,
      });
    }
  }
  const [submitting, setSubmitting] = useState(false);
  // A native pick (one-tap picker) being read into the page.
  const [readingPick, setReadingPick] = useState(false);
  // Existing drafts can still reopen their selected section. New picks
  // must already be under 10 seconds; submit revalidates the source.
  // `editing`: reopened by "Change section" on the window already in the
  // draft, whose previewUrl the draft still owns (never revoked here).
  const [pendingTrim, setPendingTrim] = useState<
    { file: File; previewUrl: string; duration: number; editing?: { start: number; end: number } } | undefined
  >(undefined);
  // "Change section" may wait for the clip length (lib/trimReopen.ts): the
  // gate drops an answer that arrives after Remove / a new pick / leaving.
  const trimReopenGate = useRef(createTrimReopenGate()).current;
  const [trimReopening, setTrimReopening] = useState(false);
  const currentDraftRef = useRef(draftSwingVideo);
  currentDraftRef.current = draftSwingVideo;
  useEffect(() => () => trimReopenGate.cancel(), [trimReopenGate]);
  // A picked video being prepared (length read + in-memory copy): only the
  // newest pick, while this page is open, may land (lib/videoSelection.ts).
  const selectionGate = useRef(createVideoSelectionGate()).current;
  const [preparingPick, setPreparingPick] = useState(false);
  const pendingTrimRef = useRef(pendingTrim);
  pendingTrimRef.current = pendingTrim;
  const swingTypeRef = useRef(swingType);
  swingTypeRef.current = swingType;
  useEffect(() => {
    selectionGate.open();
    return () => selectionGate.close();
  }, [selectionGate]);

  useEffect(() => {
    if (localStorage.getItem(UPLOAD_IN_PROGRESS_KEY)) {
      localStorage.removeItem(UPLOAD_IN_PROGRESS_KEY);
      showToast(t("caddie.uploadInterrupted"), "warning");
    }
    // Only ever meant to catch the PREVIOUS session's interruption once, on
    // arrival — not re-checked on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reported live as "pitch black" — a <video> with no poster and nothing
  // forcing a decode doesn't paint any frame at all on some mobile
  // WebViews until playback actually starts (same root cause already
  // fixed in VideoTrimSelector's own preview). A picked video sits here,
  // unplayed, for a while before anyone taps Ask Caddie, so it needs the
  // same forced seek+play+pause treatment, not just VideoTrimSelector's.
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !videoPreviewUrl) return;
    let cancelled = false;
    async function showFrame() {
      if (!video) return;
      video.currentTime = draftSwingVideo?.trimStartSeconds ?? 0;
      try {
        await video.play();
        if (!cancelled) video.pause();
      } catch {
        // Best effort — nothing else to do if autoplay is blocked here.
      }
    }
    if (video.readyState >= 1) showFrame();
    else video.addEventListener("loadedmetadata", showFrame, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", showFrame);
    };
  }, [videoPreviewUrl, draftSwingVideo?.trimStartSeconds]);

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

  function handleVideoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void acceptVideoFile(file);
  }

  // Native app (2.5+): the one-tap system picker; else the file input.
  // Either way the video lands in acceptVideoFile below.
  function selectVideo() {
    void pickMedia({
      kinds: ["video"],
      openFileInput: () => videoInputRef.current?.click(),
      onPicked: (file) => void acceptVideoFile(file),
      onLoading: setReadingPick,
      maxVideoBytes: MAX_SWING_VIDEO_BYTES,
      onTooLarge: () => showToast(t("caddie.videoTooLarge"), "warning"),
    });
  }

  async function acceptVideoFile(file: File) {
    // The newest pick wins, even one refused below: an older pick still
    // being prepared must not land after the golfer has moved on
    // (lib/videoSelection.ts).
    const token = selectionGate.begin();
    const rejection = videoPickRejection(file, MAX_SWING_VIDEO_BYTES);
    if (rejection) {
      selectionGate.end(token);
      setPreparingPick(false);
      showToast(t(rejection === "too_large" ? "caddie.videoTooLarge" : "caddie.unsupportedVideo"), "warning");
      return;
    }
    setPreparingPick(true);

    // Read duration locally before any upload. Unknown duration fails closed.
    //
    // iOS/WKWebView can evict the actual data behind a picked File's handle
    // if it just sits in memory for a while (this draft deliberately
    // survives navigating away and back, so there's no bound on how long)
    // -- a real, documented WebKit quirk for large video files. Surfaced
    // live as the upload failing at submit time with the raw browser error
    // "Load failed", sometimes well after picking, with zero server-side
    // trace (the request never even goes out -- the browser can't read
    // the file's bytes to send). Reading the bytes into a fresh File right
    // now, while the OS-backed handle is still guaranteed fresh, sidesteps
    // it: this new File is backed by our own in-memory copy, not the
    // original lazy disk-backed reference, so later eviction of that
    // original reference can't affect it. Falls back to the original file
    // if this itself fails (rare) rather than blocking selection over it.
    // A native pick already is such an in-memory copy (lib/mediaPicker.ts).
    const outcome = await prepareVideoSelection({
      gate: selectionGate,
      token,
      file,
      readDuration: readVideoDuration,
      stabilize: async (f) => (isInMemoryPick(f) ? f : new File([await f.arrayBuffer()], f.name, { type: f.type })),
      onStabilizeError: (err) => console.error("GolfMe: failed to read the video into memory.", err),
    });
    // A newer pick owns the spinner; otherwise this one is over.
    if (!selectionGate.pending) setPreparingPick(false);
    if (outcome.kind === "stale") return;
    if (outcome.kind === "rejected") {
      showToast(t(outcome.reason === "too_long" ? "caddie.videoTooLong" : "caddie.durationUnreadable"), "warning");
      return;
    }
    const { file: stableFile } = outcome;
    const previewUrl = URL.createObjectURL(stableFile);

    // Read now, not from this call's render: the selector may have changed meanwhile.
    const openTrim = pendingTrimRef.current;
    if (openTrim && !openTrim.editing) URL.revokeObjectURL(openTrim.previewUrl);
    setPendingTrim(undefined);
    setDraftSwingVideo({ file: stableFile, previewUrl, swingType: swingTypeRef.current });
  }

  function confirmTrim(trimStartSeconds: number, trimEndSeconds: number) {
    if (!pendingTrim) return;
    setDraftSwingVideo({ file: pendingTrim.file, previewUrl: pendingTrim.previewUrl, swingType, trimStartSeconds, trimEndSeconds });
    setPendingTrim(undefined);
  }

  function cancelTrim() {
    if (pendingTrim && !pendingTrim.editing) URL.revokeObjectURL(pendingTrim.previewUrl);
    setPendingTrim(undefined);
  }

  // Reopens the selector on the current window; cancelling keeps it. The
  // draft doesn't store the clip's length, so it's read again (the preview
  // element usually has it already).
  async function changeTrim() {
    const start = draftSwingVideo?.trimStartSeconds;
    const end = draftSwingVideo?.trimEndSeconds;
    if (!videoFile || !videoPreviewUrl || start === undefined || end === undefined || submitting || pendingTrim || trimReopenGate.pending) return;
    const file = videoFile;
    const previewUrl = videoPreviewUrl;
    setTrimReopening(true);
    const outcome = await resolveTrimReopen({
      gate: trimReopenGate,
      draft: { file, previewUrl },
      getDraft: () => currentDraftRef.current,
      previewDuration: previewVideoRef.current?.duration,
      readDuration: () => readVideoDuration(file),
    });
    // A newer reopen owns the flag; otherwise this one is over.
    if (!trimReopenGate.pending) setTrimReopening(false);
    if (outcome.kind === "stale") return;
    if (outcome.kind === "noDuration") {
      showToast(t("caddie.trimChangeError"), "warning");
      return;
    }
    setPendingTrim({ file, previewUrl, duration: outcome.duration, editing: { start, end } });
  }

  function removeVideo() {
    trimReopenGate.cancel();
    setTrimReopening(false);
    selectionGate.cancel();
    setPreparingPick(false);
    setDraftSwingVideo(undefined);
  }

  async function handleAnalyze() {
    if (preparingPick || readingPick || selectionGate.pending) return;
    if (!authUser || !canStartAnalysis({ hasVideo: !!videoFile, hasClub, submitting, selectorOpen: !!pendingTrim, reopening: trimReopening || trimReopenGate.pending })) return;
    if (!videoFile) return;
    setSubmitting(true);
    // Recheck restored drafts and old trim selections before Storage upload.
    // A selected 10-second window must never authorize a longer original.
    const duration = await readVideoDuration(videoFile).catch(() => undefined);
    const rejection = caddieDurationRejection(duration);
    if (rejection) {
      showToast(t(rejection === "too_long" ? "caddie.videoTooLong" : "caddie.durationUnreadable"), "warning");
      setSubmitting(false);
      return;
    }
    // Brackets the one real gap where an app exit could genuinely lose a
    // swing with no trace — see UPLOAD_IN_PROGRESS_KEY's own comment.
    // Cleared in every exit from this function below, success or failure;
    // only stays set if the app itself was killed before either happened.
    localStorage.setItem(UPLOAD_IN_PROGRESS_KEY, "1");
    // Private uploads made by this attempt — removed again only if the
    // server definitively refused to create the analysis (see below).
    const uploadedPaths: string[] = [];
    // Which half failed decides the message: the video upload (a storage
    // error's raw browser text, e.g. "Load failed", is never shown) or the
    // analyze-swing call (its error is already localized copy).
    let phase: "upload" | "analyze" = "upload";
    try {
      const rawExt = (videoFile.name.split(".").pop() ?? "").toLowerCase();
      const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : "mp4";
      const path = `${authUser.id}/caddie-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).upload(path, videoFile, { contentType: videoFile.type || "video/mp4" });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);

      let thumbnailPath: string | undefined;
      try {
        const thumbBlob = await captureVideoThumbnail(videoFile, 640, draftSwingVideo?.trimStartSeconds);
        const thumbPath = `${authUser.id}/caddie-thumb-${crypto.randomUUID()}.jpg`;
        const { error: thumbUploadError } = await supabase.storage.from(CADDIE_MEDIA_BUCKET).upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
        if (!thumbUploadError) {
          thumbnailPath = thumbPath;
          uploadedPaths.push(thumbPath);
        }
      } catch (thumbErr) {
        console.error("GolfMe: failed to capture a video thumbnail.", thumbErr);
      }

      phase = "analyze";
      const created = await createCaddieAnalysis({
        sourceType: "direct_upload",
        sourceMediaPath: path,
        thumbnailPath,
        swingType: swingType.trim() || undefined,
        startSeconds: draftSwingVideo?.trimStartSeconds,
        endSeconds: draftSwingVideo?.trimEndSeconds,
      });
      localStorage.removeItem(UPLOAD_IN_PROGRESS_KEY);
      setDraftSwingVideo(undefined);
      navigate(`/caddie/${created.id}`, { replace: true });
    } catch (err) {
      localStorage.removeItem(UPLOAD_IN_PROGRESS_KEY);
      // A 400/401/403/429 from analyze-swing means no row was created, so
      // nothing will ever reference these files — remove them rather than
      // leaving private orphans (e.g. hitting the daily limit). Any other
      // failure (network drop, gateway timeout) is ambiguous: the row may
      // exist server-side, so the files are kept.
      // Every coded refusal (kill switch, limits, cooldown, ...) also returns
      // before any insert — except "network", which means no answer at all,
      // so the row may exist.
      const definitelyNoRow =
        err instanceof CaddieRequestError &&
        err.code !== "network" &&
        ((err.status !== undefined && [400, 401, 403, 429].includes(err.status)) || !!err.code);
      if (definitelyNoRow && uploadedPaths.length > 0) {
        void supabase.storage
          .from(CADDIE_MEDIA_BUCKET)
          .remove(uploadedPaths)
          .then(({ error }) => {
            if (error) console.error("GolfMe: couldn't remove an unused Caddie upload.", error);
          });
      }
      if (phase === "upload") console.error("GolfMe: Caddie video upload failed.", err);
      // In the Caddie language (this screen is inside CaddieLocaleScope):
      // the upload half gets its own line, an analyze-swing refusal is read
      // by its stable code (caddieErrorText), never the server's English.
      showToast(phase === "upload" ? t("caddie.error.uploadFailed") : caddieErrorText(err, t), "warning");
      setSubmitting(false);
    }
  }

  // Why Ask Caddie is disabled (null: it isn't). Same rule as canStartAnalysis.
  const blocker = analysisBlocker({ hasVideo: !!videoFile, hasClub, submitting, selectorOpen: !!pendingTrim, reopening: trimReopening });

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

      {/* Replaces the single camera-angle line (its face-on advice is the last tip). */}
      <FilmingTips />

      {pendingTrim ? (
        <VideoTrimSelector
          file={pendingTrim.file}
          previewUrl={pendingTrim.previewUrl}
          duration={pendingTrim.duration}
          maxSeconds={MAX_SWING_VIDEO_SECONDS}
          initialStart={pendingTrim.editing?.start}
          initialEnd={pendingTrim.editing?.end}
          onConfirm={confirmTrim}
          onCancel={cancelTrim}
        />
      ) : videoFile && videoPreviewUrl ? (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-fairway-200 bg-fairway-50/40 p-3">
          <div className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={previewVideoRef} src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs font-semibold text-fairway-700">{videoFile.name}</span>
            <button
              onClick={removeVideo}
              disabled={submitting || trimReopening}
              className="-my-1.5 flex min-h-9 shrink-0 items-center gap-1 px-2 text-xs font-semibold text-red-600 hover:underline disabled:opacity-40"
            >
              <X size={12} /> {t("composer.remove")}
            </button>
          </div>
          {draftSwingVideo?.trimStartSeconds !== undefined && draftSwingVideo?.trimEndSeconds !== undefined && (
            <div className="flex flex-wrap items-center justify-center gap-x-2">
              <p className="text-center text-xs font-semibold text-fairway-700">
                {t("caddie.trimSelectedLabel", {
                  start: formatClock(draftSwingVideo.trimStartSeconds),
                  end: formatClock(draftSwingVideo.trimEndSeconds),
                })}
              </p>
              <button
                type="button"
                onClick={changeTrim}
                disabled={submitting || trimReopening}
                aria-busy={trimReopening || undefined}
                className="-my-1.5 flex min-h-11 items-center gap-1 px-3 text-xs font-semibold text-fairway-700 underline-offset-2 hover:underline disabled:opacity-40 motion-safe:transition-opacity"
              >
                <Scissors size={12} aria-hidden="true" /> {t("caddie.trimChange")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={selectVideo}
          disabled={readingPick}
          aria-busy={readingPick || preparingPick}
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-10 text-slate-400 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-600"
        >
          {readingPick || preparingPick ? <Loader2 size={22} className="animate-spin text-fairway-600" /> : <Video size={22} />}
          <span className="text-sm font-semibold">{t("caddie.selectVideo")}</span>
          <span className="text-xs text-slate-400">{t("caddie.noVideoSelected")}</span>
          <span className="text-xs text-slate-400">{t("caddie.recommendedLength")}</span>
        </button>
      )}
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />

      <ClubPicker value={swingType} onChange={setSwingType} disabled={submitting} />

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          fullWidth
          disabled={blocker !== null || preparingPick || readingPick}
          aria-describedby={blocker === "noClub" ? CLUB_REQUIRED_HINT_ID : undefined}
          onClick={handleAnalyze}
          icon={submitting ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
        >
          {submitting ? t("caddie.analyzing") : t("caddie.askCaddie")}
        </Button>
        {/* Only when the club is the one thing missing (a video is there, nothing else blocks). */}
        {blocker === "noClub" && (
          <p id={CLUB_REQUIRED_HINT_ID} className="text-center text-xs font-medium text-slate-500">
            {t("caddie.club.chooseToContinue")}
          </p>
        )}
      </div>
    </div>
  );
}
