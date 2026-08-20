import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ImagePlus, Loader2, MapPin, Users, Video, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Avatar } from "../components/ui/Avatar";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { POST_CATEGORIES } from "../types";
import type { PostCategory, PostType } from "../types";
import { COURSES } from "../lib/courses";
import { resizeImageToDataUrl, resizeImageToBlob, captureVideoThumbnail } from "../lib/image";
import { formatDate, formatMoney } from "../lib/format";
import { postCategoryLabel } from "../lib/enumLabels";
import { supabase } from "../lib/supabase";

type Attachment = "none" | "photo" | "course" | "round" | "swing";

const COMMUNITY_MEDIA_BUCKET = "community-media";
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit
const MAX_POST_MEDIA_ITEMS = 10; // matches Instagram's own carousel cap — a sensible, familiar limit, not an arbitrary one

interface DraftMediaItem {
  id: string;
  kind: "image" | "video";
  url: string;
  thumbnailUrl?: string; // video items only
}

// Caddie's "Share to Community" hands off here via navigate(..., { state })
// — a real video already sitting in community-media, so posting must reuse
// that URL directly rather than re-uploading a second copy of the same file.
export interface CreatePostSwingPrefill {
  swingVideoUrl: string;
  videoThumbnailUrl?: string;
  caption?: string;
}

export function CreatePost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, golfCalls, createPost } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const prefill = location.state as CreatePostSwingPrefill | null;

  const [text, setText] = useState(prefill?.caption ?? "");
  // activeTool is UI-only — which picker panel is currently expanded below
  // the pills. It must never be the thing that decides what's attached;
  // that's exactly the bug being fixed here (see doc comment further down).
  const [activeTool, setActiveTool] = useState<Attachment>(prefill?.swingVideoUrl ? "swing" : "none");
  const [mediaItems, setMediaItems] = useState<DraftMediaItem[]>([]);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [videoFile, setVideoFile] = useState<File | undefined>(undefined);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | undefined>(prefill?.swingVideoUrl);
  // Set only for a prefilled video that's already uploaded — publishing
  // must skip the upload step and reuse this URL as-is. Cleared the moment
  // the user picks a different video file, since that's a genuinely new
  // upload no longer represented by this URL.
  const [prefilledVideoUrl, setPrefilledVideoUrl] = useState<string | undefined>(prefill?.swingVideoUrl);
  const [courseQuery, setCourseQuery] = useState("");
  const [courseTag, setCourseTag] = useState<string | undefined>(undefined);
  const [golfCallId, setGolfCallId] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<PostCategory>("General");
  // Swing-post-only, both optional — let a golfer ask for feedback right
  // when they post instead of only after (a Coach Reviewer discovering the
  // post organically, or a separate trip to Caddie afterward).
  const [requestCoachReview, setRequestCoachReview] = useState(false);
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "publishing">("idle");
  // Holds a not-yet-run attach action while we wait for the user to confirm
  // replacing whatever's already attached — see requestAttach() below.
  const [pendingAttach, setPendingAttach] = useState<(() => void) | null>(null);

  const myCalls = useMemo(
    () => golfCalls.filter((c) => c.hostId === currentUser.id || c.joinedGolferIds.includes(currentUser.id)),
    [golfCalls, currentUser.id],
  );
  const selectedCall = golfCallId ? golfCalls.find((c) => c.id === golfCallId) : undefined;

  const filteredCourses = courseQuery ? COURSES.filter((c) => c.toLowerCase().includes(courseQuery.toLowerCase())).slice(0, 6) : [];

  // community_posts.type is a single value (a post can't be both a photo
  // post and a swing post), so exactly one attachment kind is ever "the"
  // attachment. This derives which one from what's actually populated,
  // rather than from whichever tool panel happens to be open — that
  // decoupling is the actual fix for the "switching tabs deletes my swing
  // video" bug: previously `attachment` (now split into `activeTool` here)
  // was used for both "which panel is shown" AND "what's attached," so
  // opening a different panel cleared the other one's state as a side
  // effect. Priority order (swing highest) matches the brief's explicit
  // "the swing video is the PRIMARY content" instruction.
  function attachedKind(): Attachment {
    if (videoFile || prefilledVideoUrl) return "swing";
    if (mediaItems.length > 0) return "photo";
    if (courseTag) return "course";
    if (golfCallId) return "round";
    return "none";
  }

  // Attaching something new while a *different* kind is already attached
  // needs the user's explicit confirmation before the old one is replaced
  // (never a silent destroy). Attaching the same kind again (e.g. swapping
  // one photo for another) or attaching when nothing else is attached just
  // runs immediately.
  function requestAttach(kind: Attachment, run: () => void) {
    const existing = attachedKind();
    if (existing !== "none" && existing !== kind) {
      setPendingAttach(() => run);
      return;
    }
    run();
  }

  // Uploads run one file at a time and each item is appended to
  // mediaItems as soon as it finishes — a mixed batch of photos/videos
  // shows up progressively rather than as one all-or-nothing wait, and one
  // bad file (wrong type, too large, a failed upload) is skipped with a
  // toast instead of losing the whole batch.
  async function doAttachMedia(files: File[]) {
    setMediaUploading(true);
    setActiveTool("photo");
    try {
      for (const file of files) {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");
        if (!isVideo && !isImage) {
          showToast(`"${file.name}" isn't a photo or video — skipped.`, "warning");
          continue;
        }
        if (isVideo && file.size > MAX_SWING_VIDEO_BYTES) {
          showToast(`"${file.name}" is too large — skipped.`, "warning");
          continue;
        }
        if (isVideo && (isDemo || !authUser)) {
          showToast("Video attachments need a real GolfMe account — skipped.", "warning");
          continue;
        }

        try {
          if (isVideo) {
            const path = `${authUser!.id}/post-${crypto.randomUUID()}.${file.name.split(".").pop() ?? "mp4"}`;
            const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, file, { contentType: file.type });
            if (uploadError) throw uploadError;
            const url = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

            let thumbnailUrl: string | undefined;
            try {
              const thumbBlob = await captureVideoThumbnail(file);
              const thumbPath = `${authUser!.id}/post-thumb-${crypto.randomUUID()}.jpg`;
              const { error: thumbUploadError } = await supabase.storage
                .from(COMMUNITY_MEDIA_BUCKET)
                .upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
              if (!thumbUploadError) thumbnailUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(thumbPath).data.publicUrl;
            } catch (thumbErr) {
              console.error("Golf Me: failed to capture a video thumbnail.", thumbErr);
            }
            setMediaItems((prev) => [...prev, { id: crypto.randomUUID(), kind: "video", url, thumbnailUrl }]);
          } else {
            let url: string;
            if (!isDemo && authUser) {
              const blob = await resizeImageToBlob(file);
              const path = `${authUser.id}/${crypto.randomUUID()}.jpg`;
              const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
              if (uploadError) throw uploadError;
              url = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
            } else {
              url = await resizeImageToDataUrl(file);
            }
            setMediaItems((prev) => [...prev, { id: crypto.randomUUID(), kind: "image", url }]);
          }
        } catch {
          showToast(`Couldn't upload "${file.name}" — skipped.`, "warning");
        }
      }
    } finally {
      setMediaUploading(false);
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const remainingSlots = MAX_POST_MEDIA_ITEMS - mediaItems.length;
    if (remainingSlots <= 0) {
      showToast(`You can attach up to ${MAX_POST_MEDIA_ITEMS} photos/videos per post.`, "warning");
      return;
    }
    const toAttach = files.slice(0, remainingSlots);
    if (files.length > toAttach.length) showToast(`Only the first ${remainingSlots} were added — ${MAX_POST_MEDIA_ITEMS} per post max.`, "warning");
    requestAttach("photo", () => void doAttachMedia(toAttach));
  }

  function doAttachVideo(file: File) {
    setPrefilledVideoUrl(undefined);
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setActiveTool("swing");
  }

  function handleVideoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      showToast("Please choose a video file.", "warning");
      return;
    }
    if (file.size > MAX_SWING_VIDEO_BYTES) {
      showToast("That video is too large — please choose a shorter clip.", "warning");
      return;
    }
    requestAttach("swing", () => doAttachVideo(file));
  }

  function doAttachCourse(c: string) {
    setCourseTag(c);
    setCourseQuery("");
    setActiveTool("course");
  }

  function doAttachRound(id: string) {
    setGolfCallId(id);
    setActiveTool("round");
  }

  function removeMediaItem(id: string) {
    setMediaItems((prev) => {
      const next = prev.filter((m) => m.id !== id);
      if (next.length === 0 && activeTool === "photo") setActiveTool("none");
      return next;
    });
  }

  function removeVideo() {
    setVideoFile(undefined);
    if (videoPreviewUrl && !prefilledVideoUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(undefined);
    setPrefilledVideoUrl(undefined);
    if (activeTool === "swing") setActiveTool("none");
  }

  function removeCourse() {
    setCourseTag(undefined);
    if (activeTool === "course") setActiveTool("none");
  }

  function removeRound() {
    setGolfCallId(undefined);
    if (activeTool === "round") setActiveTool("none");
  }

  function handlePhotoPillClick() {
    // Unlike the single-item swing video pill, this always reopens the
    // picker — repeated use appends more items (up to the cap) rather than
    // replacing, since a post can carry several photos/videos.
    fileInputRef.current?.click();
  }

  function handleSwingPillClick() {
    if (attachedKind() === "swing") return;
    videoInputRef.current?.click();
  }

  function togglePanel(kind: Attachment) {
    setActiveTool((prev) => (prev === kind ? "none" : kind));
  }

  const kind = attachedKind();
  const canPost = text.trim().length > 0 && !mediaUploading && (kind !== "swing" || Boolean(videoFile) || Boolean(prefilledVideoUrl));

  async function handlePost() {
    if (!canPost || posting) return;
    setPosting(true);
    setUploadProgress(kind === "swing" && videoFile ? "uploading" : "publishing");
    try {
      let videoUrl: string | undefined;
      let videoThumbnailUrl: string | undefined;
      if (kind === "swing" && prefilledVideoUrl && !videoFile) {
        // Handed off from Caddie's "Share to Community" — already a real
        // Storage URL, so reuse it directly rather than uploading a second
        // copy of the same file. The thumbnail was already captured at the
        // original upload point on the caddie_analyses row (see
        // RealCaddieContext/AnalyzeSwing) and carried along in router
        // state, so it comes along here too instead of falling back to a
        // black player.
        videoUrl = prefilledVideoUrl;
        videoThumbnailUrl = prefill?.videoThumbnailUrl;
      } else if (kind === "swing" && videoFile) {
        if (isDemo || !authUser) {
          // Swing Posts have no demo/local equivalent — real Supabase
          // Storage only, per explicit product decision (a data-URL video
          // would blow past localStorage's cap almost immediately).
          showToast("Swing Post video upload needs a real GolfMe account.", "warning");
          setPosting(false);
          setUploadProgress("idle");
          return;
        }
        const path = `${authUser.id}/swing-${crypto.randomUUID()}.${videoFile.name.split(".").pop() ?? "mp4"}`;
        const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, videoFile, { contentType: videoFile.type });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
        videoUrl = data.publicUrl;

        // Best-effort: a real captured frame from the actual video, so the
        // post shows something other than a black rectangle before anyone
        // taps play — never a fake/placeholder image. A failure here
        // (unsupported codec, etc.) must never block publishing the post
        // itself, since the video already uploaded successfully.
        try {
          const thumbBlob = await captureVideoThumbnail(videoFile);
          const thumbPath = `${authUser.id}/swing-thumb-${crypto.randomUUID()}.jpg`;
          const { error: thumbUploadError } = await supabase.storage
            .from(COMMUNITY_MEDIA_BUCKET)
            .upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
          if (!thumbUploadError) {
            videoThumbnailUrl = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(thumbPath).data.publicUrl;
          }
        } catch (thumbErr) {
          console.error("Golf Me: failed to capture a video thumbnail.", thumbErr);
        }
      }

      setUploadProgress("publishing");
      const type: PostType = kind === "none" ? "text" : kind;
      await createPost({
        type,
        text,
        media: kind === "photo" ? mediaItems.map((m) => ({ type: m.kind, url: m.url, thumbnailUrl: m.thumbnailUrl })) : undefined,
        videoUrl,
        videoThumbnailUrl,
        courseTag: kind === "course" ? courseTag : undefined,
        golfCallId: kind === "round" ? golfCallId : undefined,
        category,
        coachReviewRequested: kind === "swing" ? requestCoachReview : undefined,
      });

      showToast("Post published.", "success");
      navigate("/community");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't publish your post. Please try again.", "warning");
      setPosting(false);
      setUploadProgress("idle");
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <button onClick={() => navigate("/community/guidelines")} className="text-xs font-semibold text-fairway-700 hover:underline">
          Community Guidelines
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Avatar golfer={currentUser} size="sm" />
        <p className="text-sm font-semibold text-slate-800">{currentUser.name}</p>
      </div>

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's happening?"
        rows={5}
        className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none transition focus:border-fairway-400"
      />

      {/* Persistent attachment previews — rendered whenever content exists,
          independent of which tool panel (activeTool) is currently open.
          Switching tabs above never unmounts these. */}
      {mediaItems.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {mediaItems.map((m) => (
            <div key={m.id} className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-black">
              {m.kind === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={m.url} poster={m.thumbnailUrl} className="h-full w-full object-cover" muted />
              ) : (
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              )}
              <button
                onClick={() => removeMediaItem(m.id)}
                aria-label={t("composer.remove")}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {mediaItems.length < MAX_POST_MEDIA_ITEMS && !mediaUploading && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 text-slate-400 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-600"
            >
              <ImagePlus size={18} />
              <span className="text-[11px] font-semibold">{t("composer.addMore")}</span>
            </button>
          )}
        </div>
      )}
      {mediaUploading && (
        <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
          <Loader2 size={20} className="animate-spin text-fairway-600" />
        </div>
      )}

      {(videoFile || prefilledVideoUrl) && videoPreviewUrl && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-fairway-200 bg-fairway-50/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
            <Video size={13} /> {t("composer.swingVideo")}
          </p>
          <div className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-fairway-700">
              <Check size={13} /> {t("composer.uploaded")}
            </span>
            <div className="flex gap-2">
              <button onClick={() => videoInputRef.current?.click()} className="text-xs font-semibold text-fairway-700 hover:underline">
                {t("composer.replace")}
              </button>
              <button onClick={removeVideo} className="text-xs font-semibold text-red-600 hover:underline">
                {t("composer.remove")}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-fairway-100 pt-2.5">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={requestCoachReview}
                onChange={(e) => setRequestCoachReview(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-fairway-600 focus:ring-fairway-400"
              />
              {t("composer.requestCoachReview")}
            </label>
          </div>
        </div>
      )}

      {courseTag && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fairway-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-fairway-700">
            <MapPin size={12} /> {courseTag}
            <button onClick={removeCourse} className="rounded-full p-0.5 hover:bg-fairway-100">
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      {activeTool === "course" && !courseTag && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <input value={courseQuery} onChange={(e) => setCourseQuery(e.target.value)} placeholder="Search courses..." className={inputClass} />
          {filteredCourses.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {filteredCourses.map((c) => (
                <button
                  key={c}
                  onClick={() => requestAttach("course", () => doAttachCourse(c))}
                  className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 last:border-b-0 hover:bg-fairway-50"
                >
                  <MapPin size={13} className="text-fairway-600" /> {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {golfCallId && selectedCall && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-800">{selectedCall.course}</p>
              <p className="text-xs text-slate-500">
                {formatDate(selectedCall.dateISO, locale, t)} · {selectedCall.timeLabel} · {formatMoney(selectedCall.estimatedPricePerPerson)}
              </p>
            </div>
            <button onClick={removeRound} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>
          <p className="flex items-center gap-1 text-xs text-fairway-700">
            <Users size={12} /> Attached — this post will link to that round.
          </p>
        </div>
      )}
      {activeTool === "round" && !golfCallId && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          {myCalls.length === 0 ? (
            <p className="text-xs text-slate-500">You're not hosting or playing in any Golf Calls yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {myCalls.map((c) => (
                <button
                  key={c.id}
                  onClick={() => requestAttach("round", () => doAttachRound(c.id))}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm transition hover:border-slate-300"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">{c.course}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(c.dateISO, locale, t)} · {c.timeLabel} · {formatMoney(c.estimatedPricePerPerson)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Pill active={kind === "photo"} onClick={handlePhotoPillClick}>
          <ImagePlus size={13} className="mr-1 inline" /> Photo
        </Pill>
        {!isDemo && (
          <Pill active={kind === "swing"} onClick={handleSwingPillClick}>
            <Video size={13} className="mr-1 inline" /> Swing Post
          </Pill>
        )}
        <Pill active={activeTool === "course" || kind === "course"} onClick={() => togglePanel("course")}>
          <MapPin size={13} className="mr-1 inline" /> Course
        </Pill>
        <Pill active={activeTool === "round" || kind === "round"} onClick={() => togglePanel("round")}>
          <Users size={13} className="mr-1 inline" /> GolfMe Round
        </Pill>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFile} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />

      <div>
        <label className={labelClass}>Category</label>
        <div className="flex flex-wrap gap-1.5">
          {POST_CATEGORIES.map((c) => (
            <Pill key={c} active={category === c} onClick={() => setCategory(c)}>
              {postCategoryLabel(c, t)}
            </Pill>
          ))}
        </div>
      </div>

      <Button size="lg" fullWidth disabled={!canPost || posting} onClick={handlePost} icon={posting ? <Loader2 size={16} className="animate-spin" /> : undefined}>
        {posting ? (uploadProgress === "uploading" ? "Uploading video..." : "Posting...") : "Post"}
      </Button>

      {pendingAttach && (
        <ConfirmDialog
          title={t("composer.replaceAttachmentTitle")}
          message={t("composer.replaceAttachmentMessage")}
          confirmLabel={t("composer.replace")}
          onConfirm={() => {
            const run = pendingAttach;
            setPendingAttach(null);
            // Clear whatever's currently attached before running the new
            // attach — requestAttach() only queues this dialog when the
            // kinds genuinely differ, so the old one is always safe to drop.
            setMediaItems([]);
            setVideoFile(undefined);
            if (videoPreviewUrl && !prefilledVideoUrl) URL.revokeObjectURL(videoPreviewUrl);
            setVideoPreviewUrl(undefined);
            setPrefilledVideoUrl(undefined);
            setCourseTag(undefined);
            setGolfCallId(undefined);
            run();
          }}
          onCancel={() => setPendingAttach(null)}
        />
      )}
    </div>
  );
}
