import { localWindowUrl, type MediaAttachmentItem } from "./chatMedia.ts";
import type { PostMediaItem } from "../types/index.ts";

/** Preview borrows the current draft's URLs. It never uploads, clears, or revokes them. */
export function draftMediaPreview(
  items: readonly MediaAttachmentItem[],
  selected: MediaAttachmentItem | null,
): PostMediaItem | null {
  if (!selected || selected.state !== "ready" || !items.includes(selected)) return null;
  if (selected.kind === "image") {
    return { id: selected.key, type: "image", url: selected.image.previewUrl };
  }
  return {
    id: selected.key,
    type: "video",
    url: localWindowUrl(selected.video.localUrl, selected.video.trim),
    thumbnailUrl: selected.video.posterUrl ?? undefined,
    nativeControls: true,
  };
}
