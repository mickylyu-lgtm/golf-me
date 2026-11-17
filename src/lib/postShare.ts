import type { SharePayload } from "./shareLinks.ts";
import { CANONICAL_ORIGIN } from "./shareLinks.ts";

export function isShareablePostId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Share only an opaque link, never post text, media, author or visibility.
// Opening this link still requires sign-in and the existing read permissions.
export function buildPostShare(id: string, labels: { title: string; text: string }): SharePayload | null {
  if (!isShareablePostId(id)) return null;
  return { title: labels.title, text: labels.text, url: `${CANONICAL_ORIGIN}/community/${id}` };
}
