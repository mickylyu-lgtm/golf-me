import type { PostCategory } from "../types";

export type PostAttachment = "none" | "photo" | "course" | "round" | "swing";

export interface DraftMediaItem {
  id: string;
  kind: "image" | "video";
  url: string;
  thumbnailUrl?: string; // video items only
}

// CreatePost had zero persistence — a caption typed, photos attached, or a
// course/round tagged all vanished if the golfer left the screen (a native
// photo-picker round trip, a phone call, just closing the app) and came
// back, same class of bug as Host Round's own draft loss. One slot,
// restored on mount, cleared only once the post actually publishes —
// mirrors hostRoundDraft.ts/onboardingDraft.ts.
//
// videoFile (the swing-video attachment, picked but not yet uploaded) is
// deliberately excluded — a File can't survive localStorage's JSON round
// trip, same tradeoff as Host Round's proofFile and AnalyzeSwing's own
// draftSwingVideo.file. mediaItems (photos/videos) are NOT excluded: real
// accounts upload each one to Storage the moment it's picked (see
// doAttachMedia), so by the time this draft is saved they're already
// plain URLs, not File objects. prefilledVideoUrl (Caddie's "Share to
// Community" handoff) is also just a URL string, safe to keep.
export interface CommunityPostDraft {
  text: string;
  activeTool: PostAttachment;
  mediaItems: DraftMediaItem[];
  prefilledVideoUrl?: string; // public URLs only — never a signed link
  prefilledThumbnailUrl?: string;
  // A private Caddie upload being shared, by caddie-media object path — the
  // preview link is re-signed on restore, and the public copy is only made
  // when the post is published (see CreatePost / src/lib/caddieMedia.ts).
  privateShare?: { videoPath: string; thumbnailPath?: string };
  courseTag?: string;
  golfCallId?: string;
  category: PostCategory;
  requestCoachReview: boolean;
}

// Legacy unowned drafts are deliberately not adopted by whichever account logs
// in next. Leave their bytes untouched; authorship cannot be safely inferred.
function draftKey(owner: string | null): string | null {
  return owner ? `golfme:communityPostDraft:v2:${encodeURIComponent(owner)}` : null;
}

export function loadCommunityPostDraft(owner: string | null): CommunityPostDraft | null {
  const key = draftKey(owner);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CommunityPostDraft) : null;
  } catch {
    return null;
  }
}

export function saveCommunityPostDraft(owner: string | null, draft: CommunityPostDraft): void {
  const key = draftKey(owner);
  if (!key || typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(draft)); } catch { /* Keep the in-memory draft when storage is full or unavailable. */ }
}

export function clearCommunityPostDraft(owner: string | null): void {
  const key = draftKey(owner);
  if (!key || typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
}
