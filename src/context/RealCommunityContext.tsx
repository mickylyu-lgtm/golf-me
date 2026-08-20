import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { profileRowToGolferProfile } from "../lib/profile";
import type { ProfileRow } from "../lib/profile";
import type { CommunityPost, PostComment, GolferProfile, PostType, PostCategory, SwingAnalysisStatus } from "../types";

interface PostRow {
  id: string;
  author_id: string;
  type: PostType;
  text: string;
  image_url: string | null;
  video_url: string | null;
  video_thumbnail_url: string | null;
  course_tag: string | null;
  golf_call_id: string | null;
  category: PostCategory;
  swing_analysis_status: SwingAnalysisStatus | "not_applicable";
  coach_review_requested: boolean;
  created_at: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  parent_comment_id: string | null;
  created_at: string;
}

function rowToPost(row: PostRow): CommunityPost {
  return {
    id: row.id,
    authorId: row.author_id,
    type: row.type,
    text: row.text,
    imageUrl: row.image_url ?? undefined,
    videoUrl: row.video_url ?? undefined,
    videoThumbnailUrl: row.video_thumbnail_url ?? undefined,
    swingAnalysisStatus: row.swing_analysis_status === "not_applicable" ? undefined : row.swing_analysis_status,
    courseTag: row.course_tag ?? undefined,
    golfCallId: row.golf_call_id ?? undefined,
    category: row.category,
    coachReviewRequested: row.coach_review_requested,
    createdAt: row.created_at,
  };
}

function rowToComment(row: CommentRow): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    text: row.text,
    parentCommentId: row.parent_comment_id ?? undefined,
    createdAt: row.created_at,
  };
}

export interface CreateRealPostInput {
  type: PostType;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  courseTag?: string;
  golfCallId?: string;
  category: PostCategory;
  coachReviewRequested?: boolean;
}

interface RealCommunityContextValue {
  posts: CommunityPost[];
  comments: PostComment[];
  isLoading: boolean;
  profilesById: Map<string, GolferProfile>;

  getPost: (id: string) => CommunityPost | undefined;
  createPost: (input: CreateRealPostInput) => Promise<CommunityPost>;
  deletePost: (postId: string) => Promise<void>;
  attachGolfCallToPost: (postId: string, callId: string) => Promise<void>;

  isPostUpvoted: (postId: string) => boolean;
  postUpvoteCount: (postId: string) => number;
  togglePostUpvote: (postId: string) => Promise<void>;

  isPostSaved: (postId: string) => boolean;
  savePost: (postId: string) => Promise<void>;
  unsavePost: (postId: string) => Promise<void>;
  savedPostIds: string[];

  isPostHidden: (postId: string) => boolean;
  hidePost: (postId: string) => Promise<void>;

  commentsForPost: (postId: string) => PostComment[];
  createComment: (postId: string, text: string, parentCommentId?: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  isCommentUpvoted: (commentId: string) => boolean;
  commentUpvoteCount: (commentId: string) => number;
  toggleCommentUpvote: (commentId: string) => Promise<void>;
}

const RealCommunityContext = createContext<RealCommunityContextValue | null>(null);

export function RealCommunityProvider({ children }: { children: ReactNode }) {
  const { isDemo, authUser } = useAuth();
  const [postRows, setPostRows] = useState<PostRow[]>([]);
  const [commentRows, setCommentRows] = useState<CommentRow[]>([]);
  const [postVotes, setPostVotes] = useState<{ post_id: string; voter_id: string }[]>([]);
  const [commentVotes, setCommentVotes] = useState<{ comment_id: string; voter_id: string }[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<string[]>([]);
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const fetchingRef = useRef(false);
  const selfId = authUser?.id;

  // Posts render optimistically (see createPost below) — the pending-entry
  // pattern proven out for messaging earlier this project, applied here for
  // the same reason: don't make the author wait for a network round trip
  // plus a full refetch to see their own post.
  const [pendingPosts, setPendingPosts] = useState<PostRow[]>([]);

  const refetch = useCallback(async () => {
    if (!selfId || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [
        { data: posts, error: postsErr },
        { data: comments, error: commentsErr },
        { data: pVotes, error: pVotesErr },
        { data: cVotes, error: cVotesErr },
        { data: saved, error: savedErr },
        { data: hidden, error: hiddenErr },
      ] = await Promise.all([
        supabase.from("community_posts").select("*").order("created_at", { ascending: false }),
        supabase.from("community_comments").select("*").order("created_at", { ascending: true }),
        supabase.from("community_post_votes").select("post_id, voter_id"),
        supabase.from("community_comment_votes").select("comment_id, voter_id"),
        supabase.from("saved_posts").select("post_id").eq("owner_id", selfId),
        supabase.from("hidden_posts").select("post_id").eq("owner_id", selfId),
      ]);
      if (postsErr) throw postsErr;
      if (commentsErr) throw commentsErr;
      if (pVotesErr) throw pVotesErr;
      if (cVotesErr) throw cVotesErr;
      if (savedErr) throw savedErr;
      if (hiddenErr) throw hiddenErr;

      const nextPosts = (posts ?? []) as PostRow[];
      const nextComments = (comments ?? []) as CommentRow[];
      setPostRows(nextPosts);
      setCommentRows(nextComments);
      setPostVotes((pVotes ?? []) as { post_id: string; voter_id: string }[]);
      setCommentVotes((cVotes ?? []) as { comment_id: string; voter_id: string }[]);
      setSavedPostIds((saved ?? []).map((s) => s.post_id));
      setHiddenPostIds((hidden ?? []).map((h) => h.post_id));

      const ids = new Set<string>();
      for (const p of nextPosts) ids.add(p.author_id);
      for (const c of nextComments) ids.add(c.author_id);
      if (ids.size > 0) {
        const { data: profileRows, error: profErr } = await supabase.from("profiles").select("*").in("id", Array.from(ids));
        if (profErr) throw profErr;
        const map = new Map<string, GolferProfile>();
        for (const row of (profileRows ?? []) as ProfileRow[]) map.set(row.id, profileRowToGolferProfile(row));
        setProfilesById(map);
      }
    } catch (err) {
      console.error("Golf Me: failed to load Community.", err);
    } finally {
      fetchingRef.current = false;
    }
  }, [selfId]);

  useEffect(() => {
    if (isDemo || !selfId) {
      setPostRows([]);
      setCommentRows([]);
      setPostVotes([]);
      setCommentVotes([]);
      setSavedPostIds([]);
      setHiddenPostIds([]);
      setProfilesById(new Map());
      setPendingPosts([]);
      return;
    }

    setIsLoading(true);
    refetch().finally(() => setIsLoading(false));

    const channel = supabase
      .channel("community-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_post_votes" }, () => refetch())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isDemo, selfId, refetch]);

  // Drops a pending (optimistic) post once refetch brings in the real row —
  // matched by author + exact text + created no earlier than the pending
  // entry's own timestamp, the same reconciliation strategy already proven
  // for optimistic messages.
  useEffect(() => {
    if (pendingPosts.length === 0) return;
    setPendingPosts((prev) =>
      prev.filter((pending) => !postRows.some((p) => p.author_id === pending.author_id && p.text === pending.text && p.created_at >= pending.created_at)),
    );
  }, [postRows, pendingPosts.length]);

  const posts = useMemo(() => [...pendingPosts, ...postRows].map(rowToPost), [pendingPosts, postRows]);
  const comments = useMemo(() => commentRows.map(rowToComment), [commentRows]);

  const getPost = useCallback((id: string) => posts.find((p) => p.id === id), [posts]);

  const createPost = useCallback(
    async (input: CreateRealPostInput): Promise<CommunityPost> => {
      if (!selfId) throw new Error("Not signed in.");
      const nowIso = new Date().toISOString();
      const pending: PostRow = {
        id: `pending-${crypto.randomUUID()}`,
        author_id: selfId,
        type: input.type,
        text: input.text.trim(),
        image_url: input.imageUrl ?? null,
        video_url: input.videoUrl ?? null,
        video_thumbnail_url: input.videoThumbnailUrl ?? null,
        course_tag: input.courseTag ?? null,
        golf_call_id: input.golfCallId ?? null,
        category: input.category,
        swing_analysis_status: input.type === "swing" ? "pending" : "not_applicable",
        coach_review_requested: input.coachReviewRequested ?? false,
        created_at: nowIso,
      };
      setPendingPosts((prev) => [pending, ...prev]);

      const { data, error } = await supabase
        .from("community_posts")
        .insert({
          author_id: selfId,
          type: input.type,
          text: input.text.trim(),
          image_url: input.imageUrl ?? null,
          video_url: input.videoUrl ?? null,
          video_thumbnail_url: input.videoThumbnailUrl ?? null,
          course_tag: input.courseTag ?? null,
          golf_call_id: input.golfCallId ?? null,
          category: input.category,
          swing_analysis_status: input.type === "swing" ? "pending" : "not_applicable",
          coach_review_requested: input.coachReviewRequested ?? false,
        })
        .select()
        .single();
      if (error) {
        setPendingPosts((prev) => prev.filter((p) => p.id !== pending.id));
        throw new Error(error.message);
      }
      return rowToPost(data as PostRow);
    },
    [selfId],
  );

  const deletePost = useCallback(
    async (postId: string) => {
      const { error } = await supabase.from("community_posts").delete().eq("id", postId);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const attachGolfCallToPost = useCallback(
    async (postId: string, callId: string) => {
      const { error } = await supabase.from("community_posts").update({ golf_call_id: callId }).eq("id", postId);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const isPostUpvoted = useCallback((postId: string) => postVotes.some((v) => v.post_id === postId && v.voter_id === selfId), [postVotes, selfId]);
  const postUpvoteCount = useCallback((postId: string) => postVotes.filter((v) => v.post_id === postId).length, [postVotes]);
  const togglePostUpvote = useCallback(
    async (postId: string) => {
      if (!selfId) return;
      const already = postVotes.some((v) => v.post_id === postId && v.voter_id === selfId);
      setPostVotes((prev) => (already ? prev.filter((v) => !(v.post_id === postId && v.voter_id === selfId)) : [...prev, { post_id: postId, voter_id: selfId }]));
      const { error } = already
        ? await supabase.from("community_post_votes").delete().eq("post_id", postId).eq("voter_id", selfId)
        : await supabase.from("community_post_votes").insert({ post_id: postId, voter_id: selfId });
      if (error) {
        setPostVotes((prev) => (already ? [...prev, { post_id: postId, voter_id: selfId }] : prev.filter((v) => !(v.post_id === postId && v.voter_id === selfId))));
        throw new Error(error.message);
      }
    },
    [selfId, postVotes],
  );

  const isPostSaved = useCallback((postId: string) => savedPostIds.includes(postId), [savedPostIds]);
  const savePost = useCallback(
    async (postId: string) => {
      if (!selfId || savedPostIds.includes(postId)) return;
      setSavedPostIds((prev) => [...prev, postId]);
      const { error } = await supabase.from("saved_posts").insert({ owner_id: selfId, post_id: postId });
      if (error) {
        setSavedPostIds((prev) => prev.filter((id) => id !== postId));
        throw new Error(error.message);
      }
    },
    [selfId, savedPostIds],
  );
  const unsavePost = useCallback(
    async (postId: string) => {
      if (!selfId) return;
      setSavedPostIds((prev) => prev.filter((id) => id !== postId));
      const { error } = await supabase.from("saved_posts").delete().eq("owner_id", selfId).eq("post_id", postId);
      if (error) {
        setSavedPostIds((prev) => [...prev, postId]);
        throw new Error(error.message);
      }
    },
    [selfId],
  );

  const isPostHidden = useCallback((postId: string) => hiddenPostIds.includes(postId), [hiddenPostIds]);
  const hidePost = useCallback(
    async (postId: string) => {
      if (!selfId || hiddenPostIds.includes(postId)) return;
      setHiddenPostIds((prev) => [...prev, postId]);
      const { error } = await supabase.from("hidden_posts").insert({ owner_id: selfId, post_id: postId });
      if (error) {
        setHiddenPostIds((prev) => prev.filter((id) => id !== postId));
        throw new Error(error.message);
      }
    },
    [selfId, hiddenPostIds],
  );

  const commentsForPost = useCallback((postId: string) => comments.filter((c) => c.postId === postId), [comments]);

  const createComment = useCallback(
    async (postId: string, text: string, parentCommentId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || !selfId) return;
      const { error } = await supabase.from("community_comments").insert({ post_id: postId, author_id: selfId, text: trimmed, parent_comment_id: parentCommentId ?? null });
      if (error) throw new Error(error.message);
      await refetch();
    },
    [selfId, refetch],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      const { error } = await supabase.from("community_comments").delete().eq("id", commentId);
      if (error) throw new Error(error.message);
      await refetch();
    },
    [refetch],
  );

  const isCommentUpvoted = useCallback((commentId: string) => commentVotes.some((v) => v.comment_id === commentId && v.voter_id === selfId), [commentVotes, selfId]);
  const commentUpvoteCount = useCallback((commentId: string) => commentVotes.filter((v) => v.comment_id === commentId).length, [commentVotes]);
  const toggleCommentUpvote = useCallback(
    async (commentId: string) => {
      if (!selfId) return;
      const already = commentVotes.some((v) => v.comment_id === commentId && v.voter_id === selfId);
      setCommentVotes((prev) =>
        already ? prev.filter((v) => !(v.comment_id === commentId && v.voter_id === selfId)) : [...prev, { comment_id: commentId, voter_id: selfId }],
      );
      const { error } = already
        ? await supabase.from("community_comment_votes").delete().eq("comment_id", commentId).eq("voter_id", selfId)
        : await supabase.from("community_comment_votes").insert({ comment_id: commentId, voter_id: selfId });
      if (error) {
        setCommentVotes((prev) =>
          already ? [...prev, { comment_id: commentId, voter_id: selfId }] : prev.filter((v) => !(v.comment_id === commentId && v.voter_id === selfId)),
        );
        throw new Error(error.message);
      }
    },
    [selfId, commentVotes],
  );

  const value: RealCommunityContextValue = {
    posts,
    comments,
    isLoading,
    profilesById,
    getPost,
    createPost,
    deletePost,
    attachGolfCallToPost,
    isPostUpvoted,
    postUpvoteCount,
    togglePostUpvote,
    isPostSaved,
    savePost,
    unsavePost,
    savedPostIds,
    isPostHidden,
    hidePost,
    commentsForPost,
    createComment,
    deleteComment,
    isCommentUpvoted,
    commentUpvoteCount,
    toggleCommentUpvote,
  };

  return <RealCommunityContext.Provider value={value}>{children}</RealCommunityContext.Provider>;
}

export function useRealCommunity(): RealCommunityContextValue {
  const ctx = useContext(RealCommunityContext);
  if (!ctx) throw new Error("useRealCommunity must be used within a RealCommunityProvider");
  return ctx;
}
