import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import type { CommunityPost } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useLocale } from "../../i18n/LocaleContext";
import { useRoles } from "../../lib/useRoles";
import { useCoachReviews } from "../../lib/useCoachReviews";
import type { SubmitCoachReviewInput } from "../../lib/useCoachReviews";
import { formatRelativeTime } from "../../lib/format";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { labelClass } from "../ui/FormControls";

// Kept entirely separate from CommentItem/the comments thread — Coach
// Reviews are structured feedback from a vetted reviewer, not a discussion,
// so they get their own section with their own fields rather than being
// folded into the existing comment composer.
interface ReviewFormProps {
  postId: string;
  authorId: string;
  submitReview: (input: SubmitCoachReviewInput) => Promise<void>;
  onClose: () => void;
}

function ReviewForm({ postId, authorId, submitReview, onClose }: ReviewFormProps) {
  const { showToast } = useToast();
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [suggestedDrill, setSuggestedDrill] = useState("");
  const [additionalComments, setAdditionalComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = strengths.trim().length > 0 || improvements.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await submitReview({ postId, authorUserId: authorId, strengths, improvements, suggestedDrill, additionalComments });
      showToast("Coach Review posted.", "success");
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't post your review. Please try again.", "warning");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Leave Coach Review"
      onClose={onClose}
      footer={
        <Button fullWidth disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? "Posting…" : "Post Review"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>What looks good</label>
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
        <div>
          <label className={labelClass}>What can improve</label>
          <textarea
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
        <div>
          <label className={labelClass}>Suggested correction / drill</label>
          <textarea
            value={suggestedDrill}
            onChange={(e) => setSuggestedDrill(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
        <div>
          <label className={labelClass}>Additional notes</label>
          <textarea
            value={additionalComments}
            onChange={(e) => setAdditionalComments(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400 focus:ring-2 focus:ring-fairway-100"
          />
        </div>
      </div>
    </Modal>
  );
}

export function CoachReviewSection({ post }: { post: CommunityPost }) {
  const { isDemo, authUser } = useAuth();
  const { currentUser } = useData();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { isCoachReviewer } = useRoles();
  const isSwingPost = post.type === "swing";
  const { reviews, profilesById, myReview, submitReview } = useCoachReviews(isSwingPost ? post.id : undefined);
  const [formOpen, setFormOpen] = useState(false);

  if (!isSwingPost || isDemo || !authUser) return null;

  const canReview = isCoachReviewer && !myReview && post.authorId !== currentUser.id;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-fairway-100 bg-fairway-50/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-fairway-800">
          <ShieldCheck size={15} /> Coach Review{reviews.length > 0 && ` · ${reviews.length}`}
        </p>
        {canReview && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            Leave Coach Review
          </Button>
        )}
      </div>

      {post.coachReviewRequested && reviews.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-fairway-700">
          <ShieldCheck size={12} /> This golfer requested feedback on this swing.
        </p>
      )}

      {reviews.length === 0 ? (
        <p className="text-xs text-fairway-700/70">No Coach Reviews yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((review) => {
            const reviewer = profilesById.get(review.reviewerUserId);
            return (
              <div key={review.id} className="rounded-xl bg-white p-3">
                <button onClick={() => navigate(`/golfer/${review.reviewerUserId}`)} className="flex items-center gap-2">
                  {reviewer && <Avatar golfer={reviewer} size="xs" showVerified={false} />}
                  <span className="text-xs font-semibold text-slate-800">{reviewer?.name ?? "Coach Reviewer"}</span>
                  <Badge tone="fairway" icon={<ShieldCheck size={11} />}>
                    Coach Reviewer
                  </Badge>
                </button>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-slate-700">
                  {review.strengths && (
                    <p>
                      <span className="font-semibold text-slate-800">What looks good: </span>
                      {review.strengths}
                    </p>
                  )}
                  {review.improvements && (
                    <p>
                      <span className="font-semibold text-slate-800">What can improve: </span>
                      {review.improvements}
                    </p>
                  )}
                  {review.suggestedDrill && (
                    <p>
                      <span className="font-semibold text-slate-800">Suggested drill: </span>
                      {review.suggestedDrill}
                    </p>
                  )}
                  {review.additionalComments && <p className="text-slate-600">{review.additionalComments}</p>}
                </div>
                <p className="mt-2 text-xs text-slate-400">{formatRelativeTime(review.createdAt, locale, t)}</p>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <ReviewForm postId={post.id} authorId={post.authorId} submitReview={submitReview} onClose={() => setFormOpen(false)} />
      )}
    </div>
  );
}
