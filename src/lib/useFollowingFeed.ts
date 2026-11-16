// Network side of Home's supplemental Following feed (pure parts: lib/followingFeed.ts).
//
// mode "server": pages of get_following_feed are loaded; Home merges them
//   with Community's posts (mergeFollowingPosts).
// mode "local": demo, signed out, the RPC isn't deployed yet (missing
//   function), or the first page failed: Home shows all visible Community
//   posts without supplemental pages.
// mode "pending": the first page is on its way; Home shows the local
//   Community posts meanwhile, so the feed never flashes empty.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { RpcAvailability } from "./publicDirectory";
import type { MediaRow, PostRow } from "./communityPostRow";
import {
  FOLLOWING_FEED_RPC,
  appendPage,
  classifyFeedPage,
  cursorAfter,
  followingFeedArgs,
} from "./followingFeed";

export type FollowingFeedMode = "local" | "pending" | "server";

export interface FollowingFeedState {
  mode: FollowingFeedMode;
  rows: PostRow[];
  media: MediaRow[];
  hasMore: boolean;
  loading: boolean;
}

const LOCAL: FollowingFeedState = { mode: "local", rows: [], media: [], hasMore: false, loading: false };

// One per app load: a database without the function costs one failed call
// per 10 minutes, not one per Home mount.
const availability = new RpcAvailability();

type PageResult = { kind: "rows"; rows: PostRow[]; media: MediaRow[]; hasMore: boolean } | { kind: "missing" } | { kind: "error" };

async function fetchPage(cursor: ReturnType<typeof cursorAfter>): Promise<PageResult> {
  const { data, error } = await supabase.rpc(FOLLOWING_FEED_RPC, followingFeedArgs(cursor));
  const outcome = classifyFeedPage<PostRow>(data, error);
  if (outcome.kind === "missing") return outcome;
  if (outcome.kind === "error") {
    console.error("GolfMe: failed to load the following feed.", outcome.error);
    return { kind: "error" };
  }
  const ids = outcome.rows.map((r) => r.id);
  if (ids.length === 0) return { kind: "rows", rows: [], media: [], hasMore: false };
  const { data: media, error: mediaError } = await supabase.from("community_post_media").select("*").in("post_id", ids);
  if (mediaError) {
    console.error("GolfMe: failed to load following feed media.", mediaError);
    return { kind: "error" };
  }
  return { kind: "rows", rows: outcome.rows, media: (media ?? []) as MediaRow[], hasMore: outcome.hasMore };
}

/**
 * @param enabled real account signed in (false for demo)
 * @param followKey changes when the followed set changes: the first page is
 *   fetched again so a new follow's older posts appear.
 */
export function useFollowingFeed(enabled: boolean, selfId: string | undefined, followKey: string) {
  const [state, setState] = useState<FollowingFeedState>(LOCAL);
  // Bumped on every reset: an answer for an older account / follow set is dropped.
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !selfId || !availability.shouldTry(FOLLOWING_FEED_RPC, Date.now())) {
      setState(LOCAL);
      return;
    }
    setState({ mode: "pending", rows: [], media: [], hasMore: false, loading: true });
    void fetchPage(null).then((result) => {
      if (generation !== generationRef.current) return;
      if (result.kind === "missing") {
        availability.markMissing(FOLLOWING_FEED_RPC, Date.now());
        setState(LOCAL);
      } else if (result.kind === "error") {
        setState(LOCAL);
      } else {
        availability.markPresent(FOLLOWING_FEED_RPC);
        setState({ mode: "server", rows: result.rows, media: result.media, hasMore: result.hasMore, loading: false });
      }
    });
  }, [enabled, selfId, followKey]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (current.mode !== "server" || !current.hasMore || current.loading) return;
    const generation = generationRef.current;
    const cursor = cursorAfter(current.rows);
    const loading = { ...current, loading: true };
    stateRef.current = loading;
    setState(loading);
    void fetchPage(cursor).then((result) => {
      if (generation !== generationRef.current) return;
      setState((prev) => {
        if (result.kind !== "rows") {
          // A later page failed: stop paging and show everything already known
          // (Community's posts and rounds), rather than retrying in a loop.
          return { ...prev, hasMore: false, loading: false };
        }
        return {
          mode: "server",
          rows: appendPage(prev.rows, result.rows),
          media: [...prev.media.filter((m) => !result.media.some((n) => n.id === m.id)), ...result.media],
          hasMore: result.hasMore,
          loading: false,
        };
      });
    });
  }, []);

  return { ...state, loadMore };
}
