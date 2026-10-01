import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useRealCommunity } from "../context/RealCommunityContext";
import { GolfMeLoader } from "../components/loading/GolfMeLoader";
import { useLocale } from "../i18n/LocaleContext";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { PostCard } from "../components/community/PostCard";
import { CommentItem } from "../components/community/CommentItem";
import { CoachReviewSection } from "../components/community/CoachReviewSection";
import { loadChatDraft, postCommentDraftKey, saveChatDraft } from "../lib/chatDraft";
import { isObjectionableContentError } from "../lib/objectionableContent";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";

export function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getPost, commentsForPost, createComment, currentUser } = useData();
  const { hasLoaded: communityLoaded } = useRealCommunity();
  const { showToast } = useToast();
  const { t } = useLocale();
  const [commentText, setCommentText] = useState(() => (id ? loadChatDraft(postCommentDraftKey(id)) : ""));
  const [submitting, setSubmitting] = useState(false);

  // iOS keyboard (capacitor.config.ts Keyboard resize:"body"): that mode
  // only shrinks document.body's inline height -- the WebView, 100dvh and
  // position:fixed stay full-screen, so the keyboard simply covers this
  // bottom-of-page composer and iOS drags the whole screen up to reveal it.
  // While the keyboard is open the composer is docked instead: the SAME
  // elements (never remounted, so the input keeps focus and the keyboard
  // stays up) switch to a fixed bar sitting exactly on top of the keyboard,
  // an in-flow spacer of the composer's height holds its place so the page
  // doesn't shift, and the page behind is scroll-locked. keyboardHeight
  // comes from the plugin's own events (the only signal that's real in
  // this mode) and is always 0 on web, where nothing here changes.
  const keyboardHeight = useKeyboardHeight();
  const composerDocked = keyboardHeight > 0;
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  // Measured on docking, before paint, so the spacer is never a frame late.
  useLayoutEffect(() => {
    if (composerDocked && composerRef.current) setComposerHeight(composerRef.current.offsetHeight);
  }, [composerDocked]);

  // Page scroll position captured when the comment box gets focus, before
  // the keyboard starts opening. iOS may pan the page to reveal the input in
  // the moment before the composer docks; if it did, the page is put back to
  // exactly where it was once docked, and again when the keyboard closes.
  // Local to this page only -- not the removed app-wide scrollTo(0,0) hack.
  const scrollYBeforeKeyboardRef = useRef<number | null>(null);
  function rememberScrollBeforeKeyboard() {
    if (!composerDocked) scrollYBeforeKeyboardRef.current = window.scrollY;
  }

  useEffect(() => {
    if (!composerDocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const saved = scrollYBeforeKeyboardRef.current;
    if (saved !== null && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTo = scrollYBeforeKeyboardRef.current;
      scrollYBeforeKeyboardRef.current = null;
      if (restoreTo !== null) requestAnimationFrame(() => window.scrollTo(0, restoreTo));
    };
  }, [composerDocked]);

  const post = id ? getPost(id) : undefined;

  // Following a link straight from one post to another reuses this same
  // mounted component (only the `id` route param changes) — without this,
  // whatever was typed for the previous post would carry over into the new
  // one's comment box instead of that post's own draft.
  useEffect(() => {
    setCommentText(id ? loadChatDraft(postCommentDraftKey(id)) : "");
  }, [id]);

  function updateCommentText(value: string) {
    setCommentText(value);
    if (id) saveChatDraft(postCommentDraftKey(id), value);
  }

  // Opened cold (shared link, refresh) the feed may not have loaded yet —
  // wait rather than flash "not found".
  if (!post && !communityLoaded) return <GolfMeLoader className="py-12" />;
  if (!post) {
    return (
      <div className="py-12 text-center text-slate-500">
        Post not found.
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const allComments = commentsForPost(post.id);
  const topLevel = allComments.filter((c) => !c.parentCommentId);
  const repliesFor = (commentId: string) => allComments.filter((c) => c.parentCommentId === commentId);

  async function submitComment() {
    if (!commentText.trim() || !post || submitting) return;
    setSubmitting(true);
    const text = commentText;
    updateCommentText("");
    try {
      await createComment(post.id, text);
    } catch (err) {
      updateCommentText(text);
      showToast(
        isObjectionableContentError(err)
          ? t("moderation.objectionableContent")
          : err instanceof Error
            ? err.message
            : "Couldn't post your comment. Please try again.",
        "warning",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <PostCard post={post} linkToDetail={false} />

      <CoachReviewSection post={post} />

      {!post.golfCallId && (
        <Button
          variant="outline"
          icon={<Sparkles size={15} />}
          onClick={() =>
            navigate(`/golf-calls/new?fromPost=${post.id}${post.courseTag ? `&course=${encodeURIComponent(post.courseTag)}` : ""}`)
          }
        >
          Create a Round From This Post
        </Button>
      )}

      <div>
        <p className="mb-3 text-sm font-bold text-slate-800">
          {t("community.comments")} · {allComments.length}
        </p>
        {topLevel.length === 0 ? (
          <p className="text-sm text-slate-400">
            {t("community.noCommentsYet")} — {t("community.beFirstToComment")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {topLevel.map((c) => (
              <CommentItem key={c.id} comment={c} postId={post.id} replies={repliesFor(c.id)} />
            ))}
          </div>
        )}
      </div>

      {composerDocked && <div aria-hidden="true" style={{ height: composerHeight }} />}
      <div
        className={
          composerDocked
            ? "fixed inset-x-0 z-40 border-t border-slate-200/70 bg-[#faf9f6] py-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
            : undefined
        }
        style={composerDocked ? { bottom: `${keyboardHeight}px` } : undefined}
      >
        <div ref={composerRef} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5">
          <Avatar golfer={currentUser} size="xs" />
          <input
            id="comment-composer-input"
            value={commentText}
            onChange={(e) => updateCommentText(e.target.value)}
            onFocus={rememberScrollBeforeKeyboard}
            onKeyDown={(e) => e.key === "Enter" && submitComment()}
            placeholder={t("community.writeCommentPlaceholder")}
            className="flex-1 bg-transparent px-1.5 text-sm outline-none"
          />
          <button
            onClick={submitComment}
            disabled={!commentText.trim() || submitting}
            className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-fairway-700 disabled:opacity-40"
          >
            {t("community.postComment")}
          </button>
        </div>
      </div>
    </div>
  );
}
