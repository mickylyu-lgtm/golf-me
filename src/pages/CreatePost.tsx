import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ImagePlus, Loader2, MapPin, Users, Video, X } from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Avatar } from "../components/ui/Avatar";
import { inputClass, labelClass } from "../components/ui/FormControls";
import { POST_CATEGORIES } from "../types";
import type { PostCategory, PostType } from "../types";
import { COURSES } from "../lib/courses";
import { resizeImageToDataUrl, resizeImageToBlob } from "../lib/image";
import { formatDate, formatMoney } from "../lib/format";
import { supabase } from "../lib/supabase";

type Attachment = "none" | "photo" | "course" | "round" | "swing";

const COMMUNITY_MEDIA_BUCKET = "community-media";
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit

export function CreatePost() {
  const navigate = useNavigate();
  const { currentUser, golfCalls, createPost } = useData();
  const { isDemo, authUser } = useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Attachment>("none");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [imageLoading, setImageLoading] = useState(false);
  const [videoFile, setVideoFile] = useState<File | undefined>(undefined);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | undefined>(undefined);
  const [courseQuery, setCourseQuery] = useState("");
  const [courseTag, setCourseTag] = useState<string | undefined>(undefined);
  const [golfCallId, setGolfCallId] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState<PostCategory>("General");
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "publishing">("idle");

  const myCalls = useMemo(
    () => golfCalls.filter((c) => c.hostId === currentUser.id || c.joinedGolferIds.includes(currentUser.id)),
    [golfCalls, currentUser.id],
  );
  const selectedCall = golfCallId ? golfCalls.find((c) => c.id === golfCallId) : undefined;

  const filteredCourses = courseQuery ? COURSES.filter((c) => c.toLowerCase().includes(courseQuery.toLowerCase())).slice(0, 6) : [];

  function chooseAttachment(next: Attachment) {
    setAttachment(next);
    if (next !== "photo") setImageUrl(undefined);
    if (next !== "course") {
      setCourseTag(undefined);
      setCourseQuery("");
    }
    if (next !== "round") setGolfCallId(undefined);
    if (next !== "swing") {
      setVideoFile(undefined);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      setVideoPreviewUrl(undefined);
    }
    if (next === "photo") fileInputRef.current?.click();
    if (next === "swing") videoInputRef.current?.click();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "warning");
      return;
    }
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
    } catch {
      showToast("Couldn't load that image — try another.", "warning");
      setAttachment("none");
    } finally {
      setImageLoading(false);
    }
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
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
  }

  const canPost = text.trim().length > 0 && !imageLoading && (attachment !== "swing" || Boolean(videoFile));

  async function handlePost() {
    if (!canPost || posting) return;
    setPosting(true);
    setUploadProgress(attachment === "swing" ? "uploading" : "publishing");
    try {
      let videoUrl: string | undefined;
      if (attachment === "swing" && videoFile) {
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
      const type: PostType = attachment === "none" ? "text" : attachment;
      await createPost({
        type,
        text,
        imageUrl: attachment === "photo" ? imageUrl : undefined,
        videoUrl,
        courseTag: attachment === "course" ? courseTag : undefined,
        golfCallId: attachment === "round" ? golfCallId : undefined,
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

      {attachment === "photo" && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-100">
          {imageLoading ? (
            <div className="flex h-40 items-center justify-center bg-slate-50">
              <Loader2 size={20} className="animate-spin text-fairway-600" />
            </div>
          ) : imageUrl ? (
            <>
              <img src={imageUrl} alt="" className="max-h-72 w-full object-cover" />
              <button
                onClick={() => chooseAttachment("none")}
                aria-label="Remove photo"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/60 text-white"
              >
                <X size={14} />
              </button>
            </>
          ) : null}
        </div>
      )}

      {attachment === "swing" && (
        <div className="relative overflow-hidden rounded-2xl border border-fairway-200 bg-fairway-50/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
            <Video size={13} /> Swing Post
          </p>
          {videoPreviewUrl ? (
            <div className="relative overflow-hidden rounded-xl">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
              <button
                onClick={() => chooseAttachment("none")}
                aria-label="Remove video"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/60 text-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Choose a video of your swing to get feedback once analysis is available.</p>
          )}
        </div>
      )}

      {attachment === "course" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          {courseTag ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fairway-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-fairway-700">
              <MapPin size={12} /> {courseTag}
              <button onClick={() => setCourseTag(undefined)} className="rounded-full p-0.5 hover:bg-fairway-100">
                <X size={12} />
              </button>
            </span>
          ) : (
            <>
              <input
                value={courseQuery}
                onChange={(e) => setCourseQuery(e.target.value)}
                placeholder="Search courses..."
                className={inputClass}
              />
              {filteredCourses.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {filteredCourses.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        setCourseTag(c);
                        setCourseQuery("");
                      }}
                      className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 last:border-b-0 hover:bg-fairway-50"
                    >
                      <MapPin size={13} className="text-fairway-600" /> {c}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {attachment === "round" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          {myCalls.length === 0 ? (
            <p className="text-xs text-slate-500">You're not hosting or playing in any Golf Calls yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {myCalls.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                    golfCallId === c.id ? "border-fairway-400 bg-fairway-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="round-tag"
                    className="accent-fairway-600"
                    checked={golfCallId === c.id}
                    onChange={() => setGolfCallId(c.id)}
                  />
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">{c.course}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(c.dateISO)} · {c.timeLabel} · {formatMoney(c.estimatedPricePerPerson)}
                    </p>
                  </div>
                  {golfCallId === c.id && <Check size={16} className="text-fairway-600" />}
                </label>
              ))}
            </div>
          )}
          {selectedCall && (
            <p className="flex items-center gap-1 text-xs text-fairway-700">
              <Users size={12} /> Attached — this post will link to that round.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Pill active={attachment === "photo"} onClick={() => chooseAttachment(attachment === "photo" ? "none" : "photo")}>
          <ImagePlus size={13} className="mr-1 inline" /> Photo
        </Pill>
        {!isDemo && (
          <Pill active={attachment === "swing"} onClick={() => chooseAttachment(attachment === "swing" ? "none" : "swing")}>
            <Video size={13} className="mr-1 inline" /> Swing Post
          </Pill>
        )}
        <Pill active={attachment === "course"} onClick={() => chooseAttachment(attachment === "course" ? "none" : "course")}>
          <MapPin size={13} className="mr-1 inline" /> Course
        </Pill>
        <Pill active={attachment === "round"} onClick={() => chooseAttachment(attachment === "round" ? "none" : "round")}>
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
              {c}
            </Pill>
          ))}
        </div>
      </div>

      <Button size="lg" fullWidth disabled={!canPost || posting} onClick={handlePost} icon={posting ? <Loader2 size={16} className="animate-spin" /> : undefined}>
        {posting ? (uploadProgress === "uploading" ? "Uploading video..." : "Posting...") : "Post"}
      </Button>
    </div>
  );
}
