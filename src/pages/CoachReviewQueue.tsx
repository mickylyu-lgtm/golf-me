import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useRoles } from "../lib/useRoles";
import { supabase } from "../lib/supabase";
import { EmptyState } from "../components/ui/EmptyState";
import { PostCard } from "../components/community/PostCard";

// Coach Reviewer-only — every swing post that requested feedback, split into
// what's still waiting on this reviewer vs. what they've already answered.
// Before this page existed, a reviewer's only way to find a request was to
// stumble onto it scrolling the ordinary Community feed; this is the "here's
// what's waiting on you" queue that was missing.
export function CoachReviewQueue() {
  const { isDemo, authUser } = useAuth();
  const { currentUser, posts } = useData();
  const { isCoachReviewer, loading: rolesLoading } = useRoles();
  const navigate = useNavigate();
  const [reviewedPostIds, setReviewedPostIds] = useState<Set<string>>(new Set());
  const [loadingReviewed, setLoadingReviewed] = useState(true);

  useEffect(() => {
    if (isDemo || !authUser) {
      setLoadingReviewed(false);
      return;
    }
    let cancelled = false;
    setLoadingReviewed(true);
    supabase
      .from("coach_reviews")
      .select("post_id")
      .eq("reviewer_user_id", authUser.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Golf Me: failed to load reviewed posts.", error);
        } else {
          setReviewedPostIds(new Set((data ?? []).map((r) => r.post_id as string)));
        }
        setLoadingReviewed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDemo, authUser]);

  if (isDemo) return <Navigate to="/" replace />;
  if (!rolesLoading && !isCoachReviewer) return <Navigate to="/" replace />;

  const requested = posts.filter((p) => p.type === "swing" && p.coachReviewRequested && p.authorId !== currentUser.id);
  const pending = requested.filter((p) => !reviewedPostIds.has(p.id));
  const reviewed = requested.filter((p) => reviewedPostIds.has(p.id));

  return (
    <div className="flex flex-col gap-6 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-200 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck size={20} className="text-fairway-600" /> Coach Review Queue
        </h1>
        <p className="text-sm text-slate-500">Swing posts that requested feedback.</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Needs Your Review{pending.length > 0 && ` · ${pending.length}`}</p>
        {loadingReviewed ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : pending.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={20} />} title="Nothing waiting" description="No open review requests right now." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>

      {reviewed.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">You've Reviewed · {reviewed.length}</p>
          <div className="flex flex-col gap-3">
            {reviewed.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
