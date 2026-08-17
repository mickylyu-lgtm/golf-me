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
import { resizeImageToDataUrl, resizeImageToBlob } from "../lib/image";
import { formatDate, formatMoney } from "../lib/format";
import { postCategoryLabel } from "../lib/enumLabels";
import { supabase } from "../lib/supabase";

type Attachment = "none" | "photo" | "course" | "round" | "swing";

const COMMUNITY_MEDIA_BUCKET = "community-media";
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit

// Caddie's "Share to Community" hands off here via navigate(..., { state })
// — a real video already sitting in community-media, so posting must reuse
// that URL directly rather than re-uploading a second copy of the same file.
export interface CreatePostSwingPrefill {
  swingVideoUrl: string;
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
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [imageLoading, setImageLoading] = useState(false);
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
    if (imageUrl) return "photo";
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

  async function doAttachPhoto(file: File) {
    setImageLoading(true);
    try {
      if (!isDemo && authUser) {
        const blob = await resizeImageToBlob(file);
        const path = `${authUser.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
        setImageUrl(data.publicUrl);
      } else {
        setImageUrl(await resizeImageToDataUrl(file));
      }
      setActiveTool("photo");
    } catch {
      showToast("Couldn't load that image — try another.", "warning");
    } finally {
      setImageLoading(false);
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "warning");
      return;
    }
    requestAttach("photo", () => void doAttachPhoto(file));
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

  function removePhoto() {
    setImageUrl(undefined);
    if (activeTool === "photo") setActiveTool("none");
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
    if (attachedKind() === "photo") return; // already attached — managed via its own Replace/Remove
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
  const canPost = text.trim().length > 0 && !imageLoading && (kind !== "swing" || Boolean(videoFile) || Boolean(prefilledVideoUrl));

  async function handlePost() {
    if (!canPost || posting) return;
    setPosting(true);
    setUploadProgress(kind === "swing" && videoFile ? "uploading" : "publishing");
    try {
      let videoUrl: string | undefined;
      if (kind === "swing" && prefilledVideoUrl && !videoFile) {
        // Handed off from Caddie's "Share to Community" — already a real
        // Storage URL, so reuse it directly rather than uploading a second
        // copy of the same file.
        videoUrl = prefilledVideoUrl;
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
      }

      setUploadProgress("publishing");
      const type: PostType = kind === "none" ? "text" : kind;
      await createPost({
        type,
        text,
        imageUrl: kind === "photo" ? imageUrl : undefined,
        videoUrl,
        courseTag: kind === "course" ? courseTag : undefined,
        golfCallId: kind === "round" ? golfCallId : undefined,
        category,
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
      {imageUrl && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-100">
          <img src={imageUrl} alt="" className="max-h-72 w-full object-cover" />
          <button
            onClick={removePhoto}
            aria-label={t("composer.remove")}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/60 text-white"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {imageLoading && !imageUrl && (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
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
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
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
            setImageUrl(undefined);
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
