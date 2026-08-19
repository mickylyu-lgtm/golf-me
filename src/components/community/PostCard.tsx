import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Loader2, MapPin, MessageCircle, MoreHorizontal, ShieldAlert, ShieldCheck, ShieldOff, ShieldX, Sparkles, ThumbsUp, Trash2, Video } from "lucide-react";
import type { CommunityPost } from "../../types";
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
import { formatRelativeTime } from "../../lib/format";
import { postCategoryLabel } from "../../lib/enumLabels";
import { areaForCourse } from "../../lib/courses";
import { useLocale } from "../../i18n/LocaleContext";

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
  const [imageOpen, setImageOpen] = useState(false);
  const [askingCaddie, setAskingCaddie] = useState(false);

  const author = getGolfer(post.authorId);
  if (!author || isBlocked(post.authorId)) return null;

  const upvoted = isPostUpvoted(post.id);
  const saved = isPostSaved(post.id);
  const commentCount = commentsForPost(post.id).length;
  const isOwn = post.authorId === currentUser.id;
  const call = post.golfCallId ? getGolfCall(post.golfCallId) : undefined;

  function goToDetail() {
    if (linkToDetail) navigate(`/community/${post.id}`);
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
      navigate(`/community/${post.id}`);
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

  async function askCaddie() {
    if (!post.videoUrl || askingCaddie) return;
    setAskingCaddie(true);
    try {
      const created = await createCaddieAnalysis({
        sourceType: "community_post",
        sourcePostId: post.id,
        sourceMediaUrl: post.videoUrl,
        thumbnailUrl: post.videoThumbnailUrl,
      });
      navigate(`/caddie/${created.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("caddie.askCaddieError"), "warning");
    } finally {
      setAskingCaddie(false);
    }
  }

  return (
    <div
      className={`flex flex-col gap-3 p-4 ${linkToDetail ? "cursor-pointer" : ""} ${isSwingPost ? "border-2 border-fairway-300" : ""} ${CLICKABLE_CARD_CLASS}`}
      onClick={goToDetail}
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
              {author.verification.verifiedGolfer && <ShieldCheck size={13} className="shrink-0 text-fairway-600" />}
            </p>
            <p className="flex items-center gap-1 text-xs text-slate-400">
              {formatRelativeTime(post.createdAt, locale, t)}
              {isInCircle(author.id) && (
                <span className="flex items-center gap-0.5 text-fairway-600">
                  · <span aria-hidden>⛳</span> In Your Golf Circle
                </span>
              )}
            </p>
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

      {post.imageUrl && (
        <button
          onClick={(e) => {
            stop(e);
            setImageOpen(true);
          }}
          className="overflow-hidden rounded-xl border border-slate-100"
        >
          <img src={post.imageUrl} alt="" className="max-h-80 w-full object-cover" loading="lazy" />
        </button>
      )}

      {isSwingPost && post.videoUrl && (
        <div onClick={stop} className="flex flex-col gap-2.5">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={post.videoUrl}
            controls
            poster={post.videoThumbnailUrl}
            preload="metadata"
            className="max-h-96 w-full rounded-xl bg-black"
          />
          <SwingAnalysisPanel status={post.swingAnalysisStatus} />
          {isOwn &&
            (existingCaddieAnalysis ? (
              <button
                onClick={() => navigate(`/caddie/${existingCaddieAnalysis.id}`)}
                className="flex items-center justify-between gap-2 rounded-xl border border-fairway-100 bg-fairway-50/50 px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-fairway-300"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fairway-800">
                  <Sparkles size={14} /> {t("caddie.title")} {t("swingAnalysis.title")}
                </span>
                <span className="text-xs font-semibold text-fairway-700">{t("caddie.viewAnalysis")}</span>
              </button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                icon={askingCaddie ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                onClick={askCaddie}
                disabled={askingCaddie}
              >
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
              upvoted ? "border-transparent bg-fairway-600 text-white" : "border-slate-200 text-slate-600 hover:border-fairway-300"
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

      {imageOpen && post.imageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            stop(e);
            setImageOpen(false);
          }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/90 p-6"
        >
          <img src={post.imageUrl} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
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
