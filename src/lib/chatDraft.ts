// An unsent message a golfer typed but didn't send shouldn't vanish just
// because they navigated away or backgrounded the app — this persists one
// draft per composer (a DM thread, a golf call's group chat, a post's
// comment box, a single comment's reply box) so switching away and back
// restores exactly what was typed, same idea as onboardingDraft.ts but
// keyed per-composer instead of a single slot.
const DRAFTS_KEY = "golfme:chatDrafts";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeAll(drafts: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function loadChatDraft(key: string): string {
  return readAll()[key] ?? "";
}

export function saveChatDraft(key: string, text: string): void {
  const drafts = readAll();
  if (text) drafts[key] = text;
  else delete drafts[key];
  writeAll(drafts);
}

export function dmDraftKey(golferId: string): string {
  return `dm:${golferId}`;
}

export function groupChatDraftKey(callId: string): string {
  return `call:${callId}`;
}

export function postCommentDraftKey(postId: string): string {
  return `postComment:${postId}`;
}

export function commentReplyDraftKey(commentId: string): string {
  return `commentReply:${commentId}`;
}
