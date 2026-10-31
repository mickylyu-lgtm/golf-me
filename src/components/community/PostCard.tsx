import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  Loader2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  Sparkles,
  ThumbsUp,
  Trash2,
  Users,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CommunityPost, PostMediaItem } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ReportModal } from "../trust/ReportModal";
import { CLICKABLE_CARD_CLASS } from "../ui/cardStyles";
import { GolfCallCard } from "../golfcall/GolfCallCard";
import { SwingAnalysisPanel } from "./SwingAnalysisPanel";
import { MediaCarousel } from "./MediaCarousel";
import { FullscreenMediaViewer } from "./FullscreenMediaViewer";
import { formatRelativeTime } from "../../lib/format";
import { postCategoryLabel } from "../../lib/enumLabels";
import { areaForCourse } from "../../lib/courses";
import { enterNativeVideoFullscreen, isVideoInNativeFullscreen } from "../../lib/video";
import { isStaleProcessing, usePeriodicRerender } from "../../lib/caddieAnalysis";
import { barsCoverStyle, readVideoFrame, thumbIsDark, thumbResults, useBlurredBackdrop, type BlurredBackdrop, type FrameReadResult } from "../../lib/blurredBackdrop";
import { barsDebugEnabled, buildTag } from "../../lib/barsDebug";
import { useLocale } from "../../i18n/LocaleContext";

// A touch that moves further than this between press and release is a
// scroll or swipe, never a tap: it must not open the post or the video.
const TAP_SLOP_PX = 10;
// How long native fullscreen gets to start before the in-app viewer is used.
const NATIVE_FULLSCREEN_GRACE_MS = 1000;

// Router navigations render in a transition, so the tapped card stays on
// screen (and tappable) for a moment after the first tap. A second tap in
// that window pushed the same post again, and Back then needed two presses.
const POST_NAV_GUARD_MS = 600;
let lastPostNavAt = 0;
function claimPostNavigation(): boolean {
  const now = Date.now();
  if (now - lastPostNavAt < POST_NAV_GUARD_MS) return false;
  lastPostNavAt = now;
  return true;
}

interface PostCardProps {
  post: CommunityPost;
  /** Detail view renders the full text/comment affordances differently —
   * the feed card truncates and links through instead of opening comments inline. */
  linkToDetail?: boolean;
}

export function PostCard({ post, linkToDetail = true }: PostCardProps) {
  const {
    getGolfer,
    getGolfCall,
    currentUser,
    isInCircle,
    isPostUpvoted,
    postUpvoteCount,
    togglePostUpvote,
    isPostSaved,
    savePost,
    unsavePost,
    commentsForPost,
    deletePost,
    hidePost,
    isBlocked,
    blockUser,
    caddieAnalyses,
    createCaddieAnalysis,
  } = useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [mediaLightboxIndex, setMediaLightboxIndex] = useState<number | null>(null);
  const [feedMuted, setFeedMuted] = useState(true);
  const [askingCaddie, setAskingCaddie] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbBackdrop = useBlurredBackdrop(post.type === "swing" ? post.videoThumbnailUrl : undefined);
  const blackThumb = thumbIsDark(post.videoThumbnailUrl);
  // Read from the video's own frames when the thumbnail is missing or shows
  // no bars, so black bars baked into the video are still caught.
  const [frameBackdrop, setFrameBackdrop] = useState<BlurredBackdrop | null>(null);
  const frameScansRef = useRef(0);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const nextScanAtRef = useRef(0);
  const [frameResults, setFrameResults] = useState<FrameReadResult[]>([]);
  const videoBackdrop = thumbBackdrop?.bars ? thumbBackdrop : (frameBackdrop ?? thumbBackdrop);
  // Looks at real decoded frames: on load, when playback starts, and every
  // half second of playback after that, until bars are found or a few good
  // frames agree there are none. A frame that isn't decoded yet or is black
  // (a fade-in) doesn't count, so the scan never gives up on a frame that
  // couldn't show bars. A video whose pixels can't be read (no CORS) stops.
  function scanVideoFrame(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (thumbBackdrop?.bars || frameBackdrop?.bars || frameScansRef.current >= MAX_FRAME_SCANS) return;
    if (e.type === "timeupdate" && video.currentTime < nextScanAtRef.current) return;
    nextScanAtRef.current = video.currentTime + 0.5;
    const { backdrop, result } = readVideoFrame(video);
    if (barsDebugEnabled) setFrameResults((r) => [...r.slice(-5), result]);
    if (result === "tainted") frameScansRef.current = MAX_FRAME_SCANS;
    if (!backdrop) return;
    frameScansRef.current++;
    if (backdrop.bars || (!thumbBackdrop && !frameBackdrop)) setFrameBackdrop(backdrop);
  }
  const fallbackTimerRef = useRef<number | null>(null);
  const fallbackCleanupRef = useRef<(() => void) | null>(null);
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function cancelFullscreenFallback() {
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    fallbackCleanupRef.current?.();
    fallbackCleanupRef.current = null;
  }
  useEffect(() => cancelFullscreenFallback, []);

  // Tap vs drag, for every tap target on the card that has no native
  // button of its own (the card body, the swing video, a photo). iOS already
  // drops the click after a real scroll, but a short drag that never became a
  // scroll (or a drag that ends back near its start) could still land as a
  // click and open something mid-gesture. Keyboard activation (detail 0)
  // never has a press, so it is never treated as a drag.
  function onCardPointerDown(e: React.PointerEvent) {
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }
  function onCardPointerMove(e: React.PointerEvent) {
    const press = pressRef.current;
    if (press && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) press.moved = true;
  }
  function onCardPointerCancel() {
    if (pressRef.current) pressRef.current.moved = true; // the browser took the gesture for scrolling
  }
  function isDragClick(e?: React.MouseEvent): boolean {
    if (e && e.detail === 0) return false;
    const press = pressRef.current;
    if (!press) return false;
    if (press.moved) return true;
    return !!e && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX;
  }

  // One tap anywhere on the video opens the fullscreen viewer directly —
  // previously this waited out a double-tap window (a single tap toggled
  // feed mute, a second tap opened fullscreen). The bottom-right mute
  // button is a sibling of the video, not a click target inside it, so it
  // has its own handler below and never reaches this one.
  function handleVideoTap(e: React.MouseEvent) {
    stop(e);
    if (isDragClick(e) || mediaLightboxIndex !== null) return;
    // No preventDefault here — WebKit only honors webkitEnterFullscreen()
    // as a real user gesture when it's called with nothing upstream of it
    // in the same event having called preventDefault; doing so was
    // silently breaking fullscreen entirely (not just the earlier
    // glitch/flash it was meant to fix).
    const video = videoRef.current;
    if (!video) return;
    // Native fullscreen can be refused (metadata not loaded yet — common when
    // the feed video never autoplayed, e.g. Low Power Mode — or WebKit accepts
    // the call but never presents the player). Either way, fall back to the
    // in-app fullscreen viewer the photo/video carousels already use, so the
    // tap always opens something.
    const openInAppViewer = () => {
      videoRef.current?.pause(); // never two copies playing (with sound) at once
      setMediaLightboxIndex(0);
    };
    cancelFullscreenFallback(); // a repeat tap replaces, never stacks, the pending check
    // Remember whether native fullscreen actually started at any point,
    // rather than sampling "is it fullscreen right now" after the grace
    // period: a golfer who opens and drags the native player away within
    // that second used to get the in-app viewer popping up as well.
    let nativeStarted = false;
    const markStarted = () => {
      nativeStarted = true;
    };
    video.addEventListener("webkitbeginfullscreen", markStarted);
    video.addEventListener("fullscreenchange", markStarted);
    fallbackCleanupRef.current = () => {
      video.removeEventListener("webkitbeginfullscreen", markStarted);
      video.removeEventListener("fullscreenchange", markStarted);
    };
    if (!enterNativeVideoFullscreen(video)) {
      cancelFullscreenFallback();
      openInAppViewer();
      return;
    }
    if (isVideoInNativeFullscreen(video)) nativeStarted = true;
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      const v = videoRef.current;
      const started = nativeStarted || (!!v && isVideoInNativeFullscreen(v));
      cancelFullscreenFallback();
      if (v && !started) openInAppViewer();
    }, NATIVE_FULLSCREEN_GRACE_MS);
  }

  function toggleFeedMute(e: React.MouseEvent) {
    stop(e);
    const el = videoRef.current;
    if (el) el.muted = !el.muted;
    setFeedMuted((m) => !m);
  }

  // Feed/Reels-style autoplay: the video itself plays/pauses based on
  // whether it's actually on-screen, not on a manual tap-to-start — matches
  // the brief's explicit "like on Instagram" request. Starts muted (the
  // only way browsers allow unattended autoplay anyway) and stays muted
  // until the golfer taps it; each card gets its own observer since Community
  // renders many of these in a single scrolling list.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {
            // Autoplay can still be blocked in some embedded contexts even
            // when muted — not an error state, just leaves it paused with
            // its poster frame showing until the golfer taps play.
          });
        } else {
          el.pause();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [post.videoUrl]);

  // Re-checks the Ask-Caddie row's stale mark below as time passes.
  usePeriodicRerender(caddieAnalyses.some((a) => a.sourcePostId === post.id && a.status === "processing"));

  const author = getGolfer(post.authorId);
  if (!author || isBlocked(post.authorId)) return null;

  const upvoted = isPostUpvoted(post.id);
  const saved = isPostSaved(post.id);
  const commentCount = commentsForPost(post.id).length;
  const isOwn = post.authorId === currentUser.id;
  const call = post.golfCallId ? getGolfCall(post.golfCallId) : undefined;

  function goToDetail(e: React.MouseEvent) {
    if (!linkToDetail || isDragClick(e) || !claimPostNavigation()) return;
    navigate(`/community/${post.id}`);
  }

  // Previously this button called goToDetail() unconditionally, which is a
  // no-op whenever linkToDetail is false — exactly the case on the post's
  // own detail page (PostDetail.tsx renders this card with
  // linkToDetail={false} so tapping the card body doesn't re-navigate to
  // itself), so "Comment" silently did nothing there. On the feed, it
  // still just navigates to the detail view, where the full comment
  // section is already visible. On the detail page itself, it scrolls to
  // and focuses the existing comment composer instead.
  function goToComments() {
    if (linkToDetail) {
      if (claimPostNavigation()) navigate(`/community/${post.id}`);
      return;
    }
    const input = document.getElementById("comment-composer-input");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
  }

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  const isSwingPost = post.type === "swing";
  // Owner-only for this beta (explicit product decision) — analyzing a
  // stranger's swing and saving it to your own private history raised an
  // open permissions question the brief flagged, so Ask Caddie is scoped
  // to the post's own author until that's revisited.
  const existingCaddieAnalysis = isOwn ? caddieAnalyses.find((a) => a.sourcePostId === post.id) : undefined;
  // An abandoned pipeline leaves the row at 'processing' forever — past the
  // same stale threshold the Caddie list uses, show it as failed (with Try
  // again) instead of an endless "Analyzing…". (Periodic re-render is above
  // the early return.)
  const caddieFailed =
    existingCaddieAnalysis?.status === "failed" || (!!existingCaddieAnalysis && isStaleProcessing(existingCaddieAnalysis));

  async function askCaddie(e: React.MouseEvent) {
    stop(e);
    if (askingCaddie || !post.videoUrl) return;
    setAskingCaddie(true);
    try {
      const created = await createCaddieAnalysis({
        sourceType: "community_post",
        sourcePostId: post.id,
        sourceMediaUrl: post.videoUrl,
        thumbnailUrl: post.videoThumbnailUrl,
      });
      if (created.status === "complete") navigate(`/caddie/${created.id}`);
      // 'processing'/'failed' just falls through — the row now exists in
      // caddieAnalyses (realtime already delivered it), so the render below
      // picks up existingCaddieAnalysis on the next render and shows the
      // right state without a second navigation.
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.askCaddieError"), "warning");
    } finally {
      setAskingCaddie(false);
    }
  }

  // Normalizes every post's media into one shape for the fullscreen viewer
  // — a multi-item carousel, a swing post's single video, or a legacy
  // single-photo post's imageUrl, whichever one this post actually has.
  const displayMedia: PostMediaItem[] =
    post.media && post.media.length > 0
      ? post.media
      : isSwingPost && post.videoUrl
        ? [{ id: "swing-video", type: "video", url: post.videoUrl, thumbnailUrl: post.videoThumbnailUrl }]
        : post.imageUrl
          ? [{ id: "legacy-image", type: "image", url: post.imageUrl }]
          : [];

  return (
    <div
      className={`flex flex-col gap-3 p-4 ${linkToDetail ? "cursor-pointer" : ""} ${isSwingPost ? "border-2 border-fairway-300" : ""} ${CLICKABLE_CARD_CLASS}`}
      onClick={goToDetail}
      onPointerDown={onCardPointerDown}
      onPointerMove={onCardPointerMove}
      onPointerCancel={onCardPointerCancel}
    >
      {isSwingPost && (
        <p className="flex w-fit items-center gap-1 rounded-full bg-fairway-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          <Video size={11} /> {t("community.swingPostBadge")}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button onClick={(e) => { stop(e); navigate(`/golfer/${author.id}`); }} className="flex min-w-0 items-center gap-2.5 text-left">
          <Avatar golfer={author} size="sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
              <span className="truncate">{author.name}</span>
              {author.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-500" />}
              {isInCircle(author.id) && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-fairway-50 px-1.5 py-0.5 text-[10px] font-semibold text-fairway-700 ring-1 ring-fairway-200">
                  <Users size={10} aria-hidden /> {t("profile.golfCircle")}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">{formatRelativeTime(post.createdAt, locale, t)}</p>
          </div>
        </button>

        <div className="relative shrink-0" onClick={stop}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More options"
            className="rounded-full p-1.5 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
              {isOwn ? (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteConfirmOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={15} /> Delete post
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      hidePost(post.id);
                      showToast("Post hidden.", "info");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <ShieldOff size={15} /> Hide post
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setReportOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <ShieldAlert size={15} /> Report post
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setBlockConfirmOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <ShieldX size={15} /> Block {author.name.split(" ")[0]}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm text-slate-700">{post.text}</p>

      {!isSwingPost && displayMedia.length > 0 && (
        <div onClick={stop} className="overflow-hidden rounded-xl border border-slate-100">
          <MediaCarousel media={displayMedia} variant="card" onItemClick={(i) => {
              if (!isDragClick()) setMediaLightboxIndex(i);
            }} />
        </div>
      )}

      {isSwingPost && post.videoUrl && (
        <div onClick={stop} className="flex flex-col gap-2.5">
          {/* Fills the card edge to edge like an Instagram feed: the box
              takes the picture's own shape, clamped between 4:5 (tall phone
              videos are cropped top and bottom, centred) and 1.91:1, and
              the video covers it. No side bands, no blurred fill. Black
              bars baked into the frames are zoomed out of the box
              (barsCoverStyle). The video element always fills its box, so
              WebKit has no letterbox to paint black when the native
              fullscreen player animates back. Tap still opens the whole,
              uncropped video full screen. */}
          <div
            className="relative w-full overflow-hidden rounded-xl bg-slate-800"
            style={{ aspectRatio: feedBoxAspect(videoSize, videoBackdrop?.bars ?? null), containerType: "size" }}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              // A thumbnail captured on a black frame (older iPhone uploads)
              // is skipped: no poster, and a media fragment a second in so
              // WebKit draws a real frame of the swing instead.
              src={blackThumb ? `${post.videoUrl}#t=1` : post.videoUrl}
              poster={blackThumb ? undefined : post.videoThumbnailUrl}
              preload="metadata"
              // CORS so a frame can be read for the bar scan (Storage sends
              // the header); the poster is a plain image load either way.
              crossOrigin="anonymous"
              onLoadedMetadata={(e) => setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onLoadedData={scanVideoFrame}
              onPlaying={scanVideoFrame}
              onTimeUpdate={scanVideoFrame}
              muted={feedMuted}
              loop
              playsInline
              onClick={handleVideoTap}
              style={videoBackdrop?.bars && videoSize ? barsCoverStyle(videoBackdrop.bars, videoSize.w / videoSize.h) : undefined}
              className={`cursor-pointer ${videoBackdrop?.bars && videoSize ? "" : "absolute inset-0 h-full w-full object-cover"}`}
            />
            {barsDebugEnabled && (
              <BarsDebugReadout
                thumb={post.videoThumbnailUrl ? (thumbResults.get(post.videoThumbnailUrl) ?? "pending") : "no thumbnail"}
                frames={frameResults}
                video={videoRef.current}
                bars={videoBackdrop?.bars ?? null}
              />
            )}
            {/* A real button, not a decorative overlay — it sits above the
                video in stacking order and stops its own click from
                bubbling, so tapping it toggles feed sound in place instead
                of being caught by the video's own tap-to-fullscreen. */}
            <button
              type="button"
              aria-label={feedMuted ? "Unmute" : "Mute"}
              onClick={toggleFeedMute}
              className="absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white"
            >
              {feedMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
          <SwingAnalysisPanel status={post.swingAnalysisStatus} />
          {isOwn &&
            (existingCaddieAnalysis?.status === "complete" ? (
              <button
                onClick={(e) => {
                  stop(e);
                  navigate(`/caddie/${existingCaddieAnalysis.id}`);
                }}
                className="flex items-center justify-between gap-2 rounded-xl border border-fairway-100 bg-fairway-50/50 px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-fairway-300"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fairway-800">
                  <Sparkles size={14} /> {t("caddie.title")} {t("swingAnalysis.title")}
                </span>
                <span className="text-xs font-semibold text-brand-forest">{t("caddie.viewAnalysis")}</span>
              </button>
            ) : caddieFailed && !askingCaddie ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/50 px-3.5 py-2.5" onClick={stop}>
                <span className="text-xs font-semibold text-red-700">{t("caddie.askCaddieError")}</span>
                <Button variant="outline" size="sm" onClick={askCaddie} disabled={askingCaddie}>
                  {t("caddie.tryAgain")}
                </Button>
              </div>
            ) : existingCaddieAnalysis?.status === "processing" || askingCaddie ? (
              <div className="flex items-center gap-2 rounded-xl border border-fairway-100 bg-fairway-50/50 px-3.5 py-2.5" onClick={stop}>
                <Loader2 size={14} className="animate-spin text-fairway-600" />
                <span className="text-sm font-semibold text-fairway-800">{t("caddie.analyzing")}</span>
              </div>
            ) : (
              <Button variant="outline" size="sm" icon={<Sparkles size={14} />} onClick={askCaddie}>
                {t("caddie.askCaddie")}
              </Button>
            ))}
        </div>
      )}

      {post.type === "course" && post.courseTag && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3" onClick={stop}>
          <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
            <MapPin size={13} className="text-fairway-600" /> {post.courseTag}
          </p>
          {areaForCourse(post.courseTag) && <p className="text-xs text-slate-500">{areaForCourse(post.courseTag)}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/golf-calls?matched=1&when=weekend&radius=25`)}>
              Find Rounds
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/golf-calls/new?course=${encodeURIComponent(post.courseTag!)}`)}>
              Create Round
            </Button>
          </div>
        </div>
      )}

      {post.golfCallId && (
        <div onClick={stop}>{call ? <GolfCallCard call={call} showMatch={false} /> : <p className="text-xs text-slate-400">This round is no longer available.</p>}</div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5" onClick={stop}>
        <div className="flex items-center gap-1.5">
          <Badge tone="outline">{postCategoryLabel(post.category, t)}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => togglePostUpvote(post.id)}
            aria-pressed={upvoted}
            aria-label={upvoted ? t("community.liked") : t("community.like")}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-200 ease-out active:scale-95 ${
              upvoted ? "border-transparent bg-fairway-500 text-white" : "border-slate-200 text-slate-600 hover:border-fairway-300"
            }`}
          >
            <ThumbsUp size={13} fill={upvoted ? "currentColor" : "none"} /> {postUpvoteCount(post.id)}
          </button>
          <button
            onClick={goToComments}
            aria-label={t("community.comment")}
            className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors duration-150 hover:border-fairway-300"
          >
            <MessageCircle size={13} /> {commentCount}
          </button>
          <button
            onClick={() => {
              if (saved) {
                unsavePost(post.id);
                showToast("Removed from saved.", "info");
              } else {
                savePost(post.id);
                showToast("Saved.", "success");
              }
            }}
            aria-pressed={saved}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all duration-200 ease-out ${
              saved ? "border-transparent bg-sun-400 text-fairway-950" : "border-slate-200 text-slate-600 hover:border-sun-300"
            }`}
          >
            <Bookmark size={13} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {mediaLightboxIndex !== null && displayMedia.length > 0 && (
        <div onClick={stop}>
          <FullscreenMediaViewer media={displayMedia} initialIndex={mediaLightboxIndex} onClose={() => setMediaLightboxIndex(null)} />
        </div>
      )}

      {reportOpen && (
        <div onClick={stop}>
          <ReportModal reportedId={author.id} reportedName={author.name} context="post" postId={post.id} onClose={() => setReportOpen(false)} />
        </div>
      )}

      {deleteConfirmOpen && (
        <div onClick={stop}>
          <ConfirmDialog
            title="Delete this post?"
            message="This removes the post and its comments. This can't be undone."
            confirmLabel="Delete"
            danger
            onConfirm={async () => {
              try {
                await deletePost(post.id);
                showToast("Post deleted.", "info");
              } catch (err) {
                showToast(err instanceof Error ? err.message : "Couldn't delete this post. Please try again.", "warning");
              } finally {
                setDeleteConfirmOpen(false);
              }
            }}
            onCancel={() => setDeleteConfirmOpen(false)}
          />
        </div>
      )}

      {blockConfirmOpen && (
        <div onClick={stop}>
          <ConfirmDialog
            title={`Block ${author.name}?`}
            message="You won't see each other's posts, profiles, or Golf Calls, and they won't be able to message you. You can unblock anytime from Settings."
            confirmLabel="Block"
            danger
            onConfirm={() => {
              blockUser(author.id);
              setBlockConfirmOpen(false);
              showToast(`Blocked ${author.name}.`, "info");
            }}
            onCancel={() => setBlockConfirmOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

const MAX_FRAME_SCANS = 3;

// The feed box's width / height for a swing video: the picture's own shape
// (baked-in bars removed), clamped like Instagram's feed to 4:5 at the tall
// end and 1.91:1 at the wide end. 4:5 until the video's size is known.
function feedBoxAspect(size: { w: number; h: number } | null, bars: BlurredBackdrop["bars"]): number {
  if (!size || !size.w || !size.h) return 4 / 5;
  const w = size.w * (1 - (bars?.left ?? 0) - (bars?.right ?? 0));
  const h = size.h * (1 - (bars?.top ?? 0) - (bars?.bottom ?? 0));
  return Math.min(1.91, Math.max(4 / 5, w / Math.max(h, 1)));
}

// ?barsdebug=1 only: what the black-bar scan saw on this card.
function BarsDebugReadout({ thumb, frames, video, bars }: { thumb: string; frames: FrameReadResult[]; video: HTMLVideoElement | null; bars: BlurredBackdrop["bars"] }) {
  const pct = (n: number) => Math.round(n * 100);
  return (
    <div className="pointer-events-none absolute left-1.5 top-1.5 max-w-[90%] rounded bg-black/75 px-1.5 py-1 font-mono text-[9px] leading-tight text-lime-300">
      <div>build {buildTag()}</div>
      <div>video {video ? `${video.videoWidth}x${video.videoHeight} rs${video.readyState}` : "-"}</div>
      <div>thumb {thumb}</div>
      <div>frames {frames.length ? frames.join(",") : "none yet"}</div>
      <div>bars {bars ? `L${pct(bars.left)} R${pct(bars.right)} T${pct(bars.top)} B${pct(bars.bottom)}` : "none"}</div>
    </div>
  );
}
