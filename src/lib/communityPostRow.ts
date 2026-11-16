// The community_posts / community_post_media row shapes and their mapping to
// CommunityPost. Shared by RealCommunityContext (the Community feed) and the
// Home following feed (get_following_feed returns the same row shape), so
// PostCard gets identical posts from both.
import { isOfficialPostRow } from "./officialPost.ts";
import type { CommunityPost, PostCategory, PostMediaItem, PostType, SwingAnalysisStatus } from "../types";

export interface PostRow {
  is_official?: boolean;
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

export interface MediaRow {
  id: string;
  post_id: string;
  media_type: "image" | "video";
  media_url: string;
  thumbnail_url: string | null;
  position: number;
}

export function rowToMediaItem(row: MediaRow): PostMediaItem {
  return { id: row.id, type: row.media_type, url: row.media_url, thumbnailUrl: row.thumbnail_url ?? undefined };
}

export function rowToPost(row: PostRow, mediaRows: MediaRow[]): CommunityPost {
  const media = mediaRows
    .filter((m) => m.post_id === row.id)
    .sort((a, b) => a.position - b.position)
    .map(rowToMediaItem);
  return {
    id: row.id,
    authorId: row.author_id,
    isOfficial: isOfficialPostRow(row),
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
