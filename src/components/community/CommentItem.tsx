import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, ShieldAlert, ShieldCheck, ShieldX, ThumbsUp, Trash2 } from "lucide-react";
import type { PostComment } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui/Avatar";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ReportModal } from "../trust/ReportModal";
import { formatRelativeTime } from "../../lib/format";
import { commentReplyDraftKey, loadChatDraft, saveChatDraft } from "../../lib/chatDraft";
import { useLocale } from "../../i18n/LocaleContext";

interface CommentItemProps {
  comment: PostComment;
  postId: string;
  replies: PostComment[];
}

// Caps nesting at 2 visible levels by construction: a reply never gets its
// own "Reply" button, so replies-to-replies just aren't offered — never a
// Reddit-style unreadable comment tree.
export function CommentItem({ comment, postId, replies }: CommentItemProps) {
  const { getGolfer, currentUser, isCommentUpvoted, commentUpvoteCount, toggleCommentUpvote, deleteComment, createComment, isBlocked, blockUser } =
    useData();
  const { showToast } = useToast();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(() => loadChatDraft(commentReplyDraftKey(comment.id)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);

  const author = getGolfer(comment.authorId);
  if (!author || isBlocked(comment.authorId)) return null;

  const isOwn = comment.authorId === currentUser.id;
  const upvoted = isCommentUpvoted(comment.id);
  const isReply = Boolean(comment.parentCommentId);

  function updateReplyText(value: string) {
    setReplyText(value);
    saveChatDraft(commentReplyDraftKey(comment.id), value);
  }

  function submitReply() {
    if (!replyText.trim()) return;
    createComment(postId, replyText, comment.id);
    updateReplyText("");
    setReplyOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2.5">
        <button onClick={() => navigate(`/golfer/${author.id}`)} className="shrink-0">
          <Avatar golfer={author} size="xs" showVerified={false} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <button
              onClick={() => navigate(`/golfer/${author.id}`)}
              className="flex items-center gap-1 text-xs font-semibold text-slate-800 hover:underline"
            >
              {author.name}
              {author.verification.verifiedGolfer && <ShieldCheck size={11} className="text-fairway-500" />}
            </button>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{comment.text}</p>
          </div>
          <div className="mt-1 flex items-center gap-3 pl-1 text-xs text-slate-400">
            <span>{formatRelativeTime(comment.createdAt, locale, t)}</span>
            <button
              onClick={() => toggleCommentUpvote(comment.id)}
              className={`flex items-center gap-0.5 font-semibold transition-colors duration-150 ${upvoted ? "text-fairway-700" : "hover:text-slate-600"}`}
            >
              <ThumbsUp size={11} fill={upvoted ? "currentColor" : "none"} /> {commentUpvoteCount(comment.id)}
            </button>
            {!isReply && (
              <button onClick={() => setReplyOpen((v) => !v)} className="font-semibold hover:text-slate-600">
                Reply
              </button>
            )}
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} aria-label="More options" className="hover:text-slate-600">
                <MoreHorizontal size={13} />
              </button>
              {menuOpen && (
                <div className="absolute left-0 z-10 mt-1 w-36 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
                  {isOwn ? (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        deleteComment(comment.id);
                        showToast("Comment deleted.", "info");
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setReportOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                      >
                        <ShieldAlert size={13} /> Report
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setBlockConfirmOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                      >
                        <ShieldX size={13} /> Block
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {replyOpen && (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={replyText}
                onChange={(e) => updateReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReply()}
                placeholder={`Reply to ${author.name.split(" ")[0]}...`}
                className="flex-1 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm outline-none focus:border-fairway-400"
              />
              <button
                onClick={submitReply}
                disabled={!replyText.trim()}
                className="text-xs font-semibold text-fairway-700 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          )}

          {replies.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-2.5 border-l-2 border-slate-100 pl-3">
              {replies.map((r) => (
                <CommentItem key={r.id} comment={r} postId={postId} replies={[]} />
              ))}
            </div>
          )}
        </div>
      </div>

      {reportOpen && (
        <ReportModal reportedId={author.id} reportedName={author.name} context="comment" commentId={comment.id} onClose={() => setReportOpen(false)} />
      )}

      {blockConfirmOpen && (
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
      )}
    </div>
  );
}
