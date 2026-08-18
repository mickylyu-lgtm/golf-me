import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthContext";
import { profileRowToGolferProfile } from "./profile";
import type { ProfileRow } from "./profile";
import type { GolferProfile } from "../types";

export interface CoachReview {
  id: string;
  postId: string;
  reviewerUserId: string;
  authorUserId: string;
  strengths: string;
  improvements: string;
  suggestedDrill: string;
  additionalComments: string;
  createdAt: string;
}

interface ReviewRow {
  id: string;
  post_id: string;
  reviewer_user_id: string;
  author_user_id: string;
  strengths: string;
  improvements: string;
  suggested_drill: string;
  additional_comments: string;
  created_at: string;
}

function rowToReview(row: ReviewRow): CoachReview {
  return {
    id: row.id,
    postId: row.post_id,
    reviewerUserId: row.reviewer_user_id,
    authorUserId: row.author_user_id,
    strengths: row.strengths,
    improvements: row.improvements,
    suggestedDrill: row.suggested_drill,
    additionalComments: row.additional_comments,
    createdAt: row.created_at,
  };
}

export interface SubmitCoachReviewInput {
  postId: string;
  authorUserId: string;
  strengths: string;
  improvements: string;
  suggestedDrill: string;
  additionalComments: string;
}

// Deliberately its own standalone hook rather than folded into
// RealCommunityContext — coach_reviews is a narrow, real-only, admin-gated
// feature (matches how useFriendSearch/useRoles stay outside DataContext
// too) rather than something every post-viewing surface needs to carry.
// No profiles table FK on coach_reviews.reviewer_user_id (it references
// auth.users, same as community_comments.author_id does), so reviewer
// profile info is fetched separately and joined client-side, same pattern
// RealCommunityContext already uses for post/comment authors.
export function useCoachReviews(postId: string | undefined) {
  const { isDemo, authUser } = useAuth();
  const [reviews, setReviews] = useState<CoachReview[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (isDemo || !postId) {
      setReviews([]);
      setProfilesById(new Map());
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("coach_reviews").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    if (error) {
      console.error("Golf Me: failed to load Coach Reviews.", error);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as ReviewRow[];
    setReviews(rows.map(rowToReview));
    const ids = Array.from(new Set(rows.map((r) => r.reviewer_user_id)));
    if (ids.length > 0) {
      const { data: profileRows, error: profErr } = await supabase.from("profiles").select("*").in("id", ids);
      if (profErr) {
        console.error("Golf Me: failed to load Coach Review reviewer profiles.", profErr);
      } else {
        const map = new Map<string, GolferProfile>();
        for (const row of (profileRows ?? []) as ProfileRow[]) map.set(row.id, profileRowToGolferProfile(row));
        setProfilesById(map);
      }
    } else {
      setProfilesById(new Map());
    }
    setLoading(false);
  }, [isDemo, postId]);

  useEffect(() => {
    refetch();
    if (isDemo || !postId) return;
    const channel = supabase
      .channel(`coach-reviews-${postId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_reviews", filter: `post_id=eq.${postId}` }, () => refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isDemo, postId, refetch]);

  const myReview = reviews.find((r) => r.reviewerUserId === authUser?.id);

  const submitReview = useCallback(
    async (input: SubmitCoachReviewInput) => {
      if (!authUser) throw new Error("Not signed in.");
      const { error } = await supabase.from("coach_reviews").insert({
        post_id: input.postId,
        reviewer_user_id: authUser.id,
        author_user_id: input.authorUserId,
        strengths: input.strengths.trim(),
        improvements: input.improvements.trim(),
        suggested_drill: input.suggestedDrill.trim(),
        additional_comments: input.additionalComments.trim(),
      });
      if (error) throw new Error(error.message);
      await refetch();
    },
    [authUser, refetch],
  );

  return { reviews, profilesById, loading, myReview, submitReview };
}
