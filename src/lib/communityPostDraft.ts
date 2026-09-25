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

const DRAFT_KEY = "golfme:communityPostDraft";

export function loadCommunityPostDraft(): CommunityPostDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as CommunityPostDraft) : null;
  } catch {
    return null;
  }
}

export function saveCommunityPostDraft(draft: CommunityPostDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearCommunityPostDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DRAFT_KEY);
}
