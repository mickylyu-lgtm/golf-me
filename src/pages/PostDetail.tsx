import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { PostCard } from "../components/community/PostCard";
import { CommentItem } from "../components/community/CommentItem";

export function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getPost, commentsForPost, createComment, currentUser } = useData();
  const { showToast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const post = id ? getPost(id) : undefined;

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
    setCommentText("");
    try {
      await createComment(post.id, text);
    } catch (err) {
      setCommentText(text);
      showToast(err instanceof Error ? err.message : "Couldn't post your comment. Please try again.", "warning");
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
        <p className="mb-3 text-sm font-bold text-slate-800">Comments · {allComments.length}</p>
        {topLevel.length === 0 ? (
          <p className="text-sm text-slate-400">No comments yet — be the first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {topLevel.map((c) => (
              <CommentItem key={c.id} comment={c} postId={post.id} replies={repliesFor(c.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5">
        <Avatar golfer={currentUser} size="xs" />
        <input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitComment()}
          placeholder="Add a comment..."
          className="flex-1 bg-transparent px-1.5 text-sm outline-none"
        />
        <button
          onClick={submitComment}
          disabled={!commentText.trim() || submitting}
          className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-fairway-700 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
