import { OfficialPostOption } from "../components/community/OfficialPostOption";
import { useOfficialPostCapability } from "../lib/useOfficialPostCapability";
import { isOfficialPostError, OfficialPostPublicationUncertainError } from "../lib/officialPost";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { resizeImageToDataUrl, resizeImageToBlob, captureVideoThumbnail, readVideoDuration } from "../lib/image";
import { formatDate, formatMoney } from "../lib/format";
import { postCategoryLabel } from "../lib/enumLabels";
import { supabase } from "../lib/supabase";
import { clearCommunityPostDraft, loadCommunityPostDraft, saveCommunityPostDraft } from "../lib/communityPostDraft";
import { copyCaddieMediaToCommunity, removeCommunityMediaCreatedForFailedPost, signCaddieMediaPath } from "../lib/caddieMedia";
import type { DraftMediaItem } from "../lib/communityPostDraft";
import { isObjectionableContentError } from "../lib/objectionableContent";
import { isAccountSuspendedError } from "../lib/moderation";
import { goBack } from "../lib/goBack";
import { tapHaptic } from "../lib/tapFeedback";
import { isInMemoryPick, pickMedia, pickMediaFiles } from "../lib/mediaPicker";
import { PostMediaCapError, createPostMediaLedger, insertBySeq, uploadIntoSlots } from "../lib/postMediaLedger";

type Attachment = "none" | "photo" | "course" | "round" | "swing";

const COMMUNITY_MEDIA_BUCKET = "community-media";
const MAX_SWING_VIDEO_BYTES = 200 * 1024 * 1024; // matches the Storage bucket's own file_size_limit
const MAX_SWING_VIDEO_SECONDS = 15; // Caddie's Roboflow pass calls once per sampled frame (~8fps) — a longer cap multiplies calls/latency per analysis, see analyze-swing's ANALYSIS_FPS comment
const MAX_POST_MEDIA_ITEMS = 10; // matches Instagram's own carousel cap — a sensible, familiar limit, not an arbitrary one

// Caddie's "Share to Community" hands off here via navigate(..., { state }).
// Two shapes:
//  * A private direct upload (privateVideoPath set): the video lives in the
//    PRIVATE caddie-media bucket. swingVideoUrl is only a short-lived signed
//    URL for the preview. Publishing copies the files into public
//    community-media (copyCaddieMediaToCommunity) so the post never points
//    at the private original — and abandoning the share leaves nothing
//    public.
//  * Ask Caddie on a Community post (no privateVideoPath): swingVideoUrl is
//    already a public community-media URL and is reused as-is.
export interface CreatePostSwingPrefill {
  swingVideoUrl: string;
  videoThumbnailUrl?: string;
  privateVideoPath?: string;
  privateThumbnailPath?: string;
  caption?: string;
}

export function CreatePost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, golfCalls, createPost } = useData();
  const { isDemo, authUser } = useAuth();
  const officialCapability = useOfficialPostCapability();
  // Session-local and keyed to the authenticated account. Never stored in
  // the shared local draft or inferred from a founder id/demo profile.
  const [officialForId, setOfficialForId] = useState<string | null>(null);
  const isOfficial = !isDemo && Boolean(authUser?.id) && officialForId === authUser?.id;
  useEffect(() => { setOfficialForId(null); }, [isDemo, authUser?.id]);
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const prefill = location.state as CreatePostSwingPrefill | null;
  // A fresh Caddie "Share to Community" handoff always wins over an old
  // abandoned draft — it's a deliberate new action, not something to
  // silently bury under whatever was left over from before. Otherwise,
  // resumes a draft left by leaving this screen (photo picker round trip,
  // a call, closing the app) and coming back — same idea as
  // hostRoundDraft.ts. Only consulted once per mount.
  const draft = prefill ? null : loadCommunityPostDraft();

  const [text, setText] = useState(prefill?.caption ?? draft?.text ?? "");
  // activeTool is UI-only — which picker panel is currently expanded below
  // the pills. It must never be the thing that decides what's attached;
  // that's exactly the bug being fixed here (see doc comment further down).
  const [activeTool, setActiveTool] = useState<Attachment>(
    prefill?.swingVideoUrl || prefill?.privateVideoPath ? "swing" : (draft?.activeTool ?? "none"),
  );
  const [mediaItems, setMediaItems] = useState<DraftMediaItem[]>(draft?.mediaItems ?? []);
  // The synchronous slot bookkeeping behind mediaItems (lib/postMediaLedger.ts):
  // the cap and "still uploading" are decided by it, never by React state
  // alone. Seeded once with the restored draft's items.
  const [mediaLedger] = useState(() => createPostMediaLedger(MAX_POST_MEDIA_ITEMS, (draft?.mediaItems ?? []).map((m) => m.id)));
  // Mirrors mediaLedger.pending (set from it after every change, so it can't
  // drift or go negative); one batch finishing doesn't clear another's.
  const [pendingUploads, setPendingUploads] = useState(0);
  const mediaUploading = pendingUploads > 0;
  // Leaving the page cancels whatever is still uploading: a late result is
  // dropped instead of landing in a page that's gone.
  useEffect(() => () => mediaLedger.cancelPending(), [mediaLedger]);
  // A native video pick (one-tap picker) being read into the page.
  const [readingPick, setReadingPick] = useState(false);
  // Never restored from the draft — a File can't survive localStorage's
  // JSON round trip (see communityPostDraft.ts). A golfer resuming a swing
  // Post draft re-picks the video; everything else about the draft is
  // still there.
  const [videoFile, setVideoFile] = useState<File | undefined>(undefined);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | undefined>(prefill?.swingVideoUrl ?? draft?.prefilledVideoUrl);
  // Set only for a prefilled video that's already uploaded — publishing
  // must skip the upload step and reuse this URL as-is. Cleared the moment
  // the user picks a different video file, since that's a genuinely new
  // upload no longer represented by this URL.
  const [prefilledVideoUrl, setPrefilledVideoUrl] = useState<string | undefined>(prefill?.swingVideoUrl || draft?.prefilledVideoUrl || undefined);
  // A private Caddie video being shared (see CreatePostSwingPrefill). When
  // set, prefilledVideoUrl/videoPreviewUrl are only a signed preview link —
  // never saved to the draft and never published.
  const [privateShare, setPrivateShare] = useState<{ videoPath: string; thumbnailPath?: string } | undefined>(
    prefill?.privateVideoPath ? { videoPath: prefill.privateVideoPath, thumbnailPath: prefill.privateThumbnailPath } : draft?.privateShare,
  );
  const prefilledThumbnailUrl = prefill?.videoThumbnailUrl ?? draft?.prefilledThumbnailUrl;
  const [courseQuery, setCourseQuery] = useState("");
  const [courseTag, setCourseTag] = useState<string | undefined>(draft?.courseTag);
  const [golfCallId, setGolfCallId] = useState<string | undefined>(draft?.golfCallId);
  const [category, setCategory] = useState<PostCategory>(draft?.category ?? "General");
  // Swing-post-only, both optional — let a golfer ask for feedback right
  // when they post instead of only after (a Coach Reviewer discovering the
  // post organically, or a separate trip to Caddie afterward).
  const [requestCoachReview, setRequestCoachReview] = useState(draft?.requestCoachReview ?? false);
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "publishing">("idle");
  // Holds a not-yet-run attach action while we wait for the user to confirm
  // replacing whatever's already attached — see requestAttach() below.
  const [pendingAttach, setPendingAttach] = useState<(() => void) | null>(null);

  // Persists a resumable draft on every change (not videoFile — see its
  // own state comment above). Cleared only once the post actually
  // publishes (see handlePost).
  useEffect(() => {
    saveCommunityPostDraft({
      text,
      activeTool,
      mediaItems,
      // A signed preview link expires — a private share is saved by path.
      prefilledVideoUrl: privateShare ? undefined : prefilledVideoUrl,
      prefilledThumbnailUrl: privateShare ? undefined : prefilledThumbnailUrl,
      privateShare,
      courseTag,
      golfCallId,
      category,
      requestCoachReview,
    });
  }, [text, activeTool, mediaItems, prefilledVideoUrl, prefilledThumbnailUrl, privateShare, courseTag, golfCallId, category, requestCoachReview]);

  // A private share restored from a draft (or handed over before its
  // signed URL was ready) needs a fresh preview link.
  useEffect(() => {
    if (!privateShare || prefilledVideoUrl || videoFile) return;
    let cancelled = false;
    void signCaddieMediaPath(privateShare.videoPath).then((url) => {
      if (cancelled || !url) return;
      setPrefilledVideoUrl(url);
      setVideoPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [privateShare, prefilledVideoUrl, videoFile]);

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
    if (videoFile || prefilledVideoUrl || privateShare) return "swing";
    // Photos still uploading count too: attaching another kind meanwhile
    // asks first (and cancels them) instead of mixing both into one post.
    if (mediaItems.length > 0 || mediaUploading) return "photo";
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

  // One photo/video into community-media (or a data URL in demo). Throws
  // on failure; uploadIntoSlots skips that file with a toast.
  async function uploadPostMedia(file: File): Promise<Omit<DraftMediaItem, "id">> {
    if (file.type.startsWith("video/")) {
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
        console.error("GolfMe: failed to capture a video thumbnail.", thumbErr);
      }
      return { kind: "video", url, thumbnailUrl };
    }
    if (!isDemo && authUser) {
      const blob = await resizeImageToBlob(file);
      const path = `${authUser.id}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;
      return { kind: "image", url: supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl };
    }
    return { kind: "image", url: await resizeImageToDataUrl(file) };
  }

  // Uploads run one file at a time and each item lands in mediaItems as
  // soon as it finishes — a mixed batch of photos/videos shows up
  // progressively rather than as one all-or-nothing wait, and one bad file
  // (wrong type, too large, a failed upload) is skipped with a toast
  // instead of losing the whole batch. Slots are reserved synchronously
  // here, before any await, so a second pick while this one runs (or two
  // picks before a render) can't take the post past the cap.
  function doAttachMedia(files: File[]) {
    const usable: File[] = [];
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
      usable.push(file);
    }
    if (usable.length === 0) return;
    const slots = mediaLedger.reserve(usable.length);
    if (slots.length === 0) {
      showToast(`You can attach up to ${MAX_POST_MEDIA_ITEMS} photos/videos per post.`, "warning");
      return;
    }
    if (slots.length < usable.length) showToast(`Only the first ${slots.length} were added — ${MAX_POST_MEDIA_ITEMS} per post max.`, "warning");
    setPendingUploads(mediaLedger.pending);
    setActiveTool("photo");
    void uploadIntoSlots<File, DraftMediaItem>({
      ledger: mediaLedger,
      batch: slots.map((slot, i) => ({ file: usable[i], slot })),
      upload: uploadPostMedia,
      onCommitted: (item) => setMediaItems((prev) => insertBySeq(prev, item, mediaLedger.seqOf)),
      onFailed: (file) => showToast(`Couldn't upload "${file.name}" — skipped.`, "warning"),
      onChange: () => setPendingUploads(mediaLedger.pending),
    });
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    attachFiles(files);
  }

  // Photos and videos, several at once: in the native app (2.5+) the system
  // picker with up to the remaining slots, in selection order; else the
  // multi-select file input. Either way they land in attachFiles.
  function selectMedia() {
    // Counts uploads still running, not just the items already shown.
    const remainingSlots = mediaLedger.remaining;
    if (remainingSlots <= 0) {
      showToast(`You can attach up to ${MAX_POST_MEDIA_ITEMS} photos/videos per post.`, "warning");
      return;
    }
    void pickMediaFiles({
      kinds: ["image", "video"],
      limit: remainingSlots,
      openFileInput: () => fileInputRef.current?.click(),
      onPicked: attachFiles,
      onLoading: setReadingPick,
      maxVideoBytes: MAX_SWING_VIDEO_BYTES,
      onTooLarge: () => showToast("A video was too large — skipped.", "warning"),
    });
  }

  function attachFiles(files: File[]) {
    if (files.length === 0) return;
    // The cap itself is enforced by the slot reservation in doAttachMedia
    // (synchronous, counting uploads still running); this only saves a
    // confirm dialog when nothing could be added anyway.
    if (attachedKind() === "photo" && mediaLedger.remaining <= 0) {
      showToast(`You can attach up to ${MAX_POST_MEDIA_ITEMS} photos/videos per post.`, "warning");
      return;
    }
    requestAttach("photo", () => doAttachMedia(files));
  }

  function doAttachVideo(file: File) {
    setPrefilledVideoUrl(undefined);
    setPrivateShare(undefined);
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setActiveTool("swing");
  }

  function handleVideoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void acceptVideoFile(file);
  }

  // The swing video: in the native app (2.5+) the one-tap system picker,
  // else the file input. Either way it lands in acceptVideoFile. The photo
  // pill's multi-select (photos and videos) stays a file input: the native
  // picker picks one item.
  function selectSwingVideo() {
    void pickMedia({
      kinds: ["video"],
      openFileInput: () => videoInputRef.current?.click(),
      onPicked: (file) => void acceptVideoFile(file),
      onLoading: setReadingPick,
      maxVideoBytes: MAX_SWING_VIDEO_BYTES,
      onTooLarge: () => showToast("That video is too large — please choose a shorter clip.", "warning"),
    });
  }

  async function acceptVideoFile(file: File) {
    if (!file.type.startsWith("video/")) {
      showToast("Please choose a video file.", "warning");
      return;
    }
    if (file.size > MAX_SWING_VIDEO_BYTES) {
      showToast("That video is too large — please choose a shorter clip.", "warning");
      return;
    }
    // A Swing Post's video is exactly what Ask Caddie later analyzes — same
    // beta clip-length recommendation as Caddie's own direct-upload flow
    // (AnalyzeSwing.tsx), enforced here too rather than only at analysis time.
    try {
      const duration = await readVideoDuration(file);
      if (duration > MAX_SWING_VIDEO_SECONDS) {
        showToast(t("caddie.videoTooLong"), "warning");
        return;
      }
    } catch {
      // Metadata read failing isn't itself disqualifying — let it through.
    }

    // Same iOS/WKWebView file-eviction risk as AnalyzeSwing.tsx's identical
    // fix (see its comment) — this attaches to the draft post, which can
    // sit around for a while before actually posting. A native pick already
    // is an in-memory copy (lib/mediaPicker.ts).
    let stableFile = file;
    if (!isInMemoryPick(file)) {
      try {
        const bytes = await file.arrayBuffer();
        stableFile = new File([bytes], file.name, { type: file.type });
      } catch (err) {
        console.error("GolfMe: failed to read the video into memory.", err);
      }
    }

    requestAttach("swing", () => doAttachVideo(stableFile));
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
    mediaLedger.remove(id);
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
    setPrivateShare(undefined);
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
    selectMedia();
  }

  function handleSwingPillClick() {
    if (attachedKind() === "swing") return;
    selectSwingVideo();
  }

  function togglePanel(kind: Attachment) {
    setActiveTool((prev) => (prev === kind ? "none" : kind));
  }

  const kind = attachedKind();
  const canPost = text.trim().length > 0 && !mediaUploading && !readingPick && (kind !== "swing" || Boolean(videoFile) || Boolean(prefilledVideoUrl) || Boolean(privateShare));

  async function handlePost() {
    if (!canPost || posting || (isOfficial && !officialCapability.canPostOfficial)) return;
    // The disabled button isn't the only guard: refuse a snapshot with
    // uploads still running, more than the cap, or items the slot ledger
    // doesn't know (state that hasn't caught up yet).
    if (mediaLedger.pending > 0) return;
    if (kind === "photo") {
      const block = mediaLedger.publishBlock(mediaItems.map((m) => m.id));
      if (block === "over_cap") {
        showToast(`You can attach up to ${MAX_POST_MEDIA_ITEMS} photos/videos per post. Remove some to post.`, "warning");
        return;
      }
      if (block) return;
    }
    setPosting(true);
    setUploadProgress(kind === "swing" && videoFile ? "uploading" : "publishing");
    // Public community-media objects THIS attempt wrote. If the post then
    // fails they'd be public with nothing pointing at them, so they're
    // removed again (never the private Caddie original, never a
    // pre-existing URL such as prefilledVideoUrl).
    const createdMediaUrls: string[] = [];
    try {
      let videoUrl: string | undefined;
      let videoThumbnailUrl: string | undefined;
      if (kind === "swing" && privateShare && !videoFile) {
        // Sharing a private Caddie upload: copy it (and its thumbnail) into
        // public community-media now, at publish time. The post references
        // only the public copy; the private original stays with the
        // analysis, and deleting this post later removes just the copy.
        if (isDemo || !authUser) {
          showToast("Swing Post video upload needs a real GolfMe account.", "warning");
          setPosting(false);
          setUploadProgress("idle");
          return;
        }
        setUploadProgress("uploading");
        videoUrl = await copyCaddieMediaToCommunity(authUser.id, privateShare.videoPath, "video");
        createdMediaUrls.push(videoUrl);
        if (privateShare.thumbnailPath) {
          try {
            videoThumbnailUrl = await copyCaddieMediaToCommunity(authUser.id, privateShare.thumbnailPath, "thumb");
            createdMediaUrls.push(videoThumbnailUrl);
          } catch (thumbErr) {
            console.error("GolfMe: failed to copy the swing thumbnail.", thumbErr);
          }
        }
      } else if (kind === "swing" && prefilledVideoUrl && !videoFile) {
        // Never publish a signed (expiring, private) link.
        if (prefilledVideoUrl.includes("/storage/v1/object/sign/")) throw new Error("Couldn't attach this swing video. Please try sharing it again.");
        // Handed off from Caddie's "Share to Community" — already a real
        // Storage URL, so reuse it directly rather than uploading a second
        // copy of the same file. The thumbnail was already captured at the
        // original upload point on the caddie_analyses row (see
        // RealCaddieContext/AnalyzeSwing) and carried along in router
        // state, so it comes along here too instead of falling back to a
        // black player.
        videoUrl = prefilledVideoUrl;
        videoThumbnailUrl = prefilledThumbnailUrl;
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
        createdMediaUrls.push(videoUrl);

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
            createdMediaUrls.push(videoThumbnailUrl);
          }
        } catch (thumbErr) {
          console.error("GolfMe: failed to capture a video thumbnail.", thumbErr);
        }
      }

      setUploadProgress("publishing");
      const type: PostType = kind === "none" ? "text" : kind;
      // Preserve the requested mode through async media preparation. The
      // context and database recheck it; never retry as a normal post.
      await createPost({
        isOfficial,
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

      tapHaptic("success");
      clearCommunityPostDraft();
      showToast("Post published.", "success");
      navigate("/community");
    } catch (err) {
      if (err instanceof OfficialPostPublicationUncertainError) {
        // Do not remove potentially published media or invite duplicate
        // publication. The resumable draft remains available after review.
        showToast(t("composer.officialPostUncertain"), "warning");
        navigate(`/community/${err.postId}`);
        return;
      }
      if (isOfficialPostError(err)) void officialCapability.refresh();
      if (createdMediaUrls.length > 0 && authUser) void removeCommunityMediaCreatedForFailedPost(authUser.id, createdMediaUrls);
      showToast(
        isOfficialPostError(err)
          ? t("composer.officialPostUnavailable")
          : isObjectionableContentError(err)
          ? t("moderation.objectionableContent")
          : isAccountSuspendedError(err)
            ? t("moderation.accountSuspended")
          : err instanceof PostMediaCapError
            ? `A post can have up to ${MAX_POST_MEDIA_ITEMS} photos/videos. Remove some and try again.`
            : err instanceof Error
            ? err.message
            : "Couldn't publish your post. Please try again.",
        "warning",
      );
      setPosting(false);
      setUploadProgress("idle");
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => goBack(navigate)}
          className="-my-2.5 flex items-center gap-1.5 py-2.5 pr-3 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
        <button onClick={() => navigate("/community/guidelines")} className="-my-2.5 py-2.5 text-xs font-semibold text-fairway-700 hover:underline">
          {t("settings.communityGuidelines")}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Avatar golfer={currentUser} size="sm" />
        <p className="text-sm font-semibold text-slate-800">{currentUser.name}</p>
      </div>

      <OfficialPostOption
        allowed={officialCapability.canPostOfficial}
        selected={isOfficial}
        loading={officialCapability.loading}
        disabled={posting}
        onChange={(selected) => setOfficialForId(selected ? authUser?.id ?? null : null)}
        onRetry={() => void officialCapability.refresh()}
      />

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("composer.placeholder")}
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
          {mediaItems.length < MAX_POST_MEDIA_ITEMS && !mediaUploading && !readingPick && (
            <button
              onClick={selectMedia}
              className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 text-slate-400 transition-colors duration-150 hover:border-fairway-300 hover:text-fairway-600"
            >
              <ImagePlus size={18} />
              <span className="text-[11px] font-semibold">{t("composer.addMore")}</span>
            </button>
          )}
        </div>
      )}
      {(mediaUploading || readingPick) && (
        <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
          <Loader2 size={20} className="animate-spin text-fairway-600" />
        </div>
      )}

      {(videoFile || prefilledVideoUrl || privateShare) && (videoPreviewUrl || privateShare) && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-fairway-200 bg-fairway-50/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fairway-700">
            <Video size={13} /> {t("composer.swingVideo")}
          </p>
          <div className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            {videoPreviewUrl ? (
              <video src={videoPreviewUrl} controls className="max-h-72 w-full rounded-xl bg-black" />
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded-xl bg-black">
                <Loader2 size={20} className="animate-spin text-white/70" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-fairway-700">
              <Check size={13} /> {t("composer.uploaded")}
            </span>
            <div className="flex gap-2">
              <button onClick={selectSwingVideo} disabled={readingPick} className="text-xs font-semibold text-fairway-700 hover:underline disabled:opacity-40">
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
            <button onClick={removeCourse} aria-label={t("composer.remove")} className="-my-2 -mr-1.5 rounded-full p-2 hover:bg-fairway-100">
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      {activeTool === "course" && !courseTag && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          <input value={courseQuery} onChange={(e) => setCourseQuery(e.target.value)} placeholder={t("composer.searchCourses")} className={inputClass} />
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
            <button onClick={removeRound} aria-label={t("composer.remove")} className="-m-1.5 rounded-full p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>
          <p className="flex items-center gap-1 text-xs text-fairway-700">
            <Users size={12} /> {t("composer.roundAttached")}
          </p>
        </div>
      )}
      {activeTool === "round" && !golfCallId && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
          {myCalls.length === 0 ? (
            <p className="text-xs text-slate-500">{t("composer.noRoundsToAttach")}</p>
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
          <ImagePlus size={13} className="mr-1 inline" /> {t("composer.photo")}
        </Pill>
        {!isDemo && (
          <Pill active={kind === "swing"} onClick={handleSwingPillClick}>
            <Video size={13} className="mr-1 inline" /> {t("community.swingPostBadge")}
          </Pill>
        )}
        <Pill active={activeTool === "course" || kind === "course"} onClick={() => togglePanel("course")}>
          <MapPin size={13} className="mr-1 inline" /> {t("composer.course")}
        </Pill>
        <Pill active={activeTool === "round" || kind === "round"} onClick={() => togglePanel("round")}>
          <Users size={13} className="mr-1 inline" /> {t("composer.golfMeRound")}
        </Pill>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFile} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />

      <div>
        <label className={labelClass}>{t("composer.category")}</label>
        <div className="flex flex-wrap gap-1.5">
          {POST_CATEGORIES.map((c) => (
            <Pill key={c} active={category === c} onClick={() => setCategory(c)}>
              {postCategoryLabel(c, t)}
            </Pill>
          ))}
        </div>
      </div>

      <Button size="lg" fullWidth disabled={!canPost || posting || (isOfficial && !officialCapability.canPostOfficial)} onClick={handlePost} icon={posting ? <Loader2 size={16} className="animate-spin" /> : undefined}>
        {posting ? (uploadProgress === "uploading" ? t("composer.uploadingVideo") : t("composer.posting")) : t(isOfficial ? "composer.postOfficial" : "composer.post")}
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
            // Also cancels photos still uploading: their late results are dropped.
            mediaLedger.clear();
            setPendingUploads(0);
            setMediaItems([]);
            setVideoFile(undefined);
            if (videoPreviewUrl && !prefilledVideoUrl) URL.revokeObjectURL(videoPreviewUrl);
            setVideoPreviewUrl(undefined);
            setPrefilledVideoUrl(undefined);
            setPrivateShare(undefined);
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
