import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { refetchOnResume } from "../lib/resumeRefetch";
import { classifyVersionError, createRefetchCoalescer, startFeedSignal } from "../lib/feedSync";
import { privatizeAnalysesOfPost } from "../lib/caddieMedia";
import { useAuth } from "./AuthContext";
import { fetchPublicProfiles } from "../lib/publicProfilesFetch";
import { INITIAL_LOAD_STATUS, applyLoadOutcome, isFirstLoadError, isRefreshError } from "../lib/loadStatus";
import { PostMediaCapError, isPostMediaCapError } from "../lib/postMediaLedger";
import { isLikeAlreadyDone, runOncePerId, type PostVoteRow } from "../lib/likeFeedback";
import type { CommunityPost, PostComment, GolferProfile, PostMediaItem, PostType, PostCategory, SwingAnalysisStatus } from "../types";

const COMMUNITY_MEDIA_BUCKET = "community-media";

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

interface MediaRow {
  id: string;
  post_id: string;
  media_type: "image" | "video";
  media_url: string;
  thumbnail_url: string | null;
  position: number;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  parent_comment_id: string | null;
  created_at: string;
}

function rowToMediaItem(row: MediaRow): PostMediaItem {
  return { id: row.id, type: row.media_type, url: row.media_url, thumbnailUrl: row.thumbnail_url ?? undefined };
}

function rowToPost(row: PostRow, mediaRows: MediaRow[]): CommunityPost {
  const media = mediaRows
    .filter((m) => m.post_id === row.id)
    .sort((a, b) => a.position - b.position)
    .map(rowToMediaItem);
  return {
    id: row.id,
    authorId: row.author_id,
    type: row.type,
    text: row.text,
    imageUrl: row.image_url ?? undefined,
    media: media.length > 0 ? media : undefined,
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

export interface CreateRealPostMediaInput {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
}

export interface CreateRealPostInput {
  type: PostType;
  text: string;
  imageUrl?: string;
  media?: CreateRealPostMediaInput[];
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
  /** True once the first fetch has finished, success OR failure (always true in demo). Check loadError before treating an empty feed as empty. */
  hasLoaded: boolean;
  /** Nothing has loaded yet and the last fetch failed (never in demo). */
  loadError: boolean;
  /** Data loaded before, but the latest refresh failed; the older data is still in state (never in demo). */
  refreshFailed: boolean;
  /** Re-runs the fetch (isLoading is true while it runs). */
  retry: () => Promise<void>;
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
  const [mediaRows, setMediaRows] = useState<MediaRow[]>([]);
  const [commentRows, setCommentRows] = useState<CommentRow[]>([]);
  const [postVotes, setPostVotes] = useState<{ post_id: string; voter_id: string }[]>([]);
  const [commentVotes, setCommentVotes] = useState<{ comment_id: string; voter_id: string }[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<string[]>([]);
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, GolferProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState(INITIAL_LOAD_STATUS);
  const selfId = authUser?.id;
  // The account the provider currently shows: a fetch that finishes after a
  // sign-out / account switch must not write the previous account's feed.
  const currentSelfRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    currentSelfRef.current = isDemo ? undefined : selfId;
  }, [isDemo, selfId]);

  // Posts render optimistically (see createPost below) — the pending-entry
  // pattern proven out for messaging earlier this project, applied here for
  // the same reason: don't make the author wait for a network round trip
  // plus a full refetch to see their own post.
  const [pendingPosts, setPendingPosts] = useState<PostRow[]>([]);

  // One fetch at a time; a request during a fetch (a moderation signal, a
  // Realtime event) queues exactly one more, so it is never dropped
  // (lib/feedSync.ts createRefetchCoalescer).
  const fetchOnce = useCallback(async () => {
    if (!selfId || currentSelfRef.current !== selfId) return;
    try {
      const [
        { data: posts, error: postsErr },
        { data: media, error: mediaErr },
        { data: comments, error: commentsErr },
        { data: pVotes, error: pVotesErr },
        { data: cVotes, error: cVotesErr },
        { data: saved, error: savedErr },
        { data: hidden, error: hiddenErr },
      ] = await Promise.all([
        supabase.from("community_posts").select("*").order("created_at", { ascending: false }),
        supabase.from("community_post_media").select("*"),
        supabase.from("community_comments").select("*").order("created_at", { ascending: true }),
        supabase.from("community_post_votes").select("post_id, voter_id"),
        supabase.from("community_comment_votes").select("comment_id, voter_id"),
        supabase.from("saved_posts").select("post_id").eq("owner_id", selfId),
        supabase.from("hidden_posts").select("post_id").eq("owner_id", selfId),
      ]);
      if (postsErr) throw postsErr;
      if (mediaErr) throw mediaErr;
      if (commentsErr) throw commentsErr;
      if (pVotesErr) throw pVotesErr;
      if (cVotesErr) throw cVotesErr;
      if (savedErr) throw savedErr;
      if (hiddenErr) throw hiddenErr;
      if (currentSelfRef.current !== selfId) return;

      const nextPosts = (posts ?? []) as PostRow[];
      const nextComments = (comments ?? []) as CommentRow[];
      setPostRows(nextPosts);
      setMediaRows((media ?? []) as MediaRow[]);
      setCommentRows(nextComments);
      setPostVotes((pVotes ?? []) as { post_id: string; voter_id: string }[]);
      setCommentVotes((cVotes ?? []) as { comment_id: string; voter_id: string }[]);
      setSavedPostIds((saved ?? []).map((s) => s.post_id));
      setHiddenPostIds((hidden ?? []).map((h) => h.post_id));

      const ids = new Set<string>();
      for (const p of nextPosts) ids.add(p.author_id);
      for (const c of nextComments) ids.add(c.author_id);
      if (ids.size > 0) {
        // Authors by id (golfer_public_profiles): a hidden golfer's posts
        // still show their name; blocked either way is absent (their posts
        // are filtered out in DataContext.visiblePosts anyway).
        const { profiles, error: profErr } = await fetchPublicProfiles(Array.from(ids));
        if (profErr) throw profErr;
        if (currentSelfRef.current !== selfId) return;
        const map = new Map<string, GolferProfile>();
        for (const g of profiles) map.set(g.id, g);
        setProfilesById(map);
      }
      setLoadStatus((prev) => applyLoadOutcome(prev, true));
    } catch (err) {
      console.error("GolfMe: failed to load Community.", err);
      // State is left as it was: a failed refresh keeps the last good feed.
      if (currentSelfRef.current === selfId) setLoadStatus((prev) => applyLoadOutcome(prev, false));
    }
  }, [selfId]);
  const fetchOnceRef = useRef(fetchOnce);
  useEffect(() => {
    fetchOnceRef.current = fetchOnce;
  }, [fetchOnce]);
  const [coalescer] = useState(() => createRefetchCoalescer(() => fetchOnceRef.current()));
  const refetch = useCallback(() => coalescer.request(), [coalescer]);

  useEffect(() => {
    if (isDemo || !selfId) {
      setPostRows([]);
      setMediaRows([]);
      setCommentRows([]);
      setPostVotes([]);
      setCommentVotes([]);
      setSavedPostIds([]);
      setHiddenPostIds([]);
      setProfilesById(new Map());
      setPendingPosts([]);
      setLoadStatus(INITIAL_LOAD_STATUS);
      return;
    }

    setIsLoading(true);
    setLoadStatus(INITIAL_LOAD_STATUS);
    refetch().finally(() => setIsLoading(false));

    // Events missed while the socket was down (app backgrounded, network
    // drop) never replay: a re-join after a drop refetches once.
    let feedJoined = false;
    let feedDropped = false;
    const channel = supabase
      .channel("community-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_post_media" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "community_post_votes" }, () => refetch())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (feedJoined && feedDropped) void refetch();
          feedJoined = true;
          feedDropped = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          feedDropped = true;
        }
      });
    // Moderation on other devices (migration 20261107280000): a removed or
    // hidden row's own UPDATE never reaches the people who can no longer read
    // it, so an opaque counter tells everyone to refetch. Off (old behaviour)
    // when the table is missing or unreadable. Its own channel, so a missing
    // table can't break the channel above.
    const signal = startFeedSignal({
      readVersion: async () => {
        const { data, error } = await supabase.from("community_feed_version").select("version").eq("id", 1).maybeSingle();
        if (error) return { ok: false, reason: classifyVersionError(error) };
        const version = Number((data as { version?: unknown } | null)?.version);
        return data && Number.isFinite(version) ? { ok: true, version } : { ok: false, reason: "missing" };
      },
      subscribe: ({ onVersion, onStatus }) => {
        const signalChannel = supabase
          .channel("community-feed-signal")
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "community_feed_version" }, (payload) =>
            onVersion(Number((payload.new as { version?: unknown }).version)),
          )
          .subscribe((status) => onStatus(status));
        return () => {
          void supabase.removeChannel(signalChannel);
        };
      },
      refetch: () => void refetch(),
    });
    const stopResume = refetchOnResume(() => void refetch());

    return () => {
      supabase.removeChannel(channel);
      signal.stop();
      stopResume();
    };
  }, [isDemo, selfId, refetch]);

  const retry = useCallback(async () => {
    setIsLoading(true);
    try {
      await refetch();
    } finally {
      setIsLoading(false);
    }
  }, [refetch]);

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

  const posts = useMemo(() => [...pendingPosts, ...postRows].map((row) => rowToPost(row, mediaRows)), [pendingPosts, postRows, mediaRows]);
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
      // Optimistic media so the carousel shows immediately too, keyed to the
      // pending row's own placeholder id — cleaned up alongside it below.
      const pendingMedia: MediaRow[] = (input.media ?? []).map((m, i) => ({
        id: `pending-${crypto.randomUUID()}`,
        post_id: pending.id,
        media_type: m.type,
        media_url: m.url,
        thumbnail_url: m.thumbnailUrl ?? null,
        position: i,
      }));
      if (pendingMedia.length > 0) setMediaRows((prev) => [...pendingMedia, ...prev]);

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
        setMediaRows((prev) => prev.filter((m) => m.post_id !== pending.id));
        throw new Error(error.message);
      }
      const newPost = data as PostRow;

      let insertedMedia: MediaRow[] = [];
      if (input.media && input.media.length > 0) {
        const { data: mediaData, error: mediaError } = await supabase
          .from("community_post_media")
          .insert(
            input.media.map((m, i) => ({
              post_id: newPost.id,
              media_type: m.type,
              media_url: m.url,
              thumbnail_url: m.thumbnailUrl ?? null,
              position: i,
            })),
          )
          .select();
        // The server's 10-per-post cap refused the media (the app caps at
        // 10 too, so only an older/modified client gets here): take the
        // just-created post back down rather than leave it live without
        // its photos, and let the composer say why (draft kept).
        if (mediaError && isPostMediaCapError(mediaError)) {
          const { error: undoError } = await supabase.from("community_posts").delete().eq("id", newPost.id);
          if (undoError) console.error("GolfMe: couldn't remove a post whose media was refused.", undoError);
          setPendingPosts((prev) => prev.filter((p) => p.id !== pending.id));
          setMediaRows((prev) => prev.filter((m) => m.post_id !== pending.id));
          throw new PostMediaCapError();
        }
        // The post itself is already live at this point — any other
        // media-insert failure must never look like the whole post failed
        // to publish. Falls back to the optimistic pendingMedia rows (still
        // keyed to the old pending.id) via the reconciliation effect below,
        // same as any other refetch-driven cleanup.
        if (mediaError) console.error("GolfMe: failed to attach post media.", mediaError);
        else insertedMedia = (mediaData ?? []) as MediaRow[];
      }
      setMediaRows((prev) => [...insertedMedia, ...prev.filter((m) => m.post_id !== pending.id)]);

      return rowToPost(newPost, insertedMedia);
    },
    [selfId],
  );

  const deletePost = useCallback(
    async (postId: string) => {
      // delete_community_post deletes the post and returns which of its
      // community-media objects are no longer referenced anywhere (a kept
      // Caddie analysis or another post can still point at the same video/
      // thumbnail -- those are never returned). See migration
      // 20260924110000_delete_community_post_with_media_cleanup.
      //
      // First, any Ask-Caddie analysis of this post gets its own private
      // copy of the video/thumbnail and stops referencing the public files
      // (private-bucket product decision: a deleted post leaves nothing
      // public behind). Must run BEFORE the RPC so its reference check sees
      // the analysis on the private copy and returns the public files for
      // removal. Best effort: a row that couldn't be privatized keeps its
      // public URL, and the RPC then keeps that file — never a dangling
      // reference. See privatizeAnalysesOfPost.
      if (selfId) {
        const notPrivatized = await privatizeAnalysesOfPost(selfId, postId);
        if (notPrivatized > 0) console.warn(`GolfMe: ${notPrivatized} Caddie analysis(es) of this post kept the public video.`);
      }
      const { data, error } = await supabase.rpc("delete_community_post", { p_post_id: postId });
      if (error) {
        // RPC not deployed yet (client shipped ahead of the migration):
        // fall back to the old direct delete so deleting still works; media
        // is just left behind, as before.
        if (error.code === "PGRST202") {
          const { error: deleteError } = await supabase.from("community_posts").delete().eq("id", postId);
          if (deleteError) throw new Error(deleteError.message);
        } else {
          throw new Error(error.message);
        }
      } else {
        const paths = ((data ?? []) as string[]).filter((p) => typeof p === "string" && p.length > 0);
        if (paths.length > 0) {
          // Best effort: the post is already gone either way, and storage
          // RLS (community_media_delete_own) only lets this remove files in
          // the caller's own folder.
          const { error: removeError } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).remove(paths);
          if (removeError) console.error("GolfMe: post deleted but its media could not be removed.", removeError);
        }
      }
      await refetch();
    },
    [refetch, selfId],
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
  // One like/unlike request per post at a time: a tap while one is in flight
  // is ignored, so rapid taps can't send a second insert (or a delete racing
  // an insert) and leave the count wrong.
  const voteInFlight = useRef(new Set<string>());
  const togglePostUpvote = useCallback(
    async (postId: string) => {
      if (!selfId) return;
      const mine = (v: PostVoteRow) => v.post_id === postId && v.voter_id === selfId;
      const add = (prev: PostVoteRow[]) => (prev.some(mine) ? prev : [...prev, { post_id: postId, voter_id: selfId }]);
      const remove = (prev: PostVoteRow[]) => prev.filter((v) => !mine(v));
      await runOncePerId(voteInFlight.current, postId, async () => {
        const already = postVotes.some(mine);
        setPostVotes(already ? remove : add);
        const { error } = already
          ? await supabase.from("community_post_votes").delete().eq("post_id", postId).eq("voter_id", selfId)
          : await supabase.from("community_post_votes").insert({ post_id: postId, voter_id: selfId });
        // Already liked on the server (another device, a stale feed): the
        // outcome the golfer asked for is true, so it is not a failure.
        if (error && !isLikeAlreadyDone(already, error.code)) {
          setPostVotes(already ? add : remove);
          throw new Error(error.message);
        }
      });
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
    hasLoaded: isDemo || loadStatus.settled,
    loadError: !isDemo && isFirstLoadError(loadStatus),
    refreshFailed: !isDemo && isRefreshError(loadStatus),
    retry,
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
