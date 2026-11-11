// An unsent message a golfer typed but didn't send shouldn't vanish just
// because they navigated away or backgrounded the app — this persists one
// draft per composer (a DM thread, a golf call's group chat, a post's
// comment box, a single comment's reply box) so switching away and back
// restores exactly what was typed, same idea as onboardingDraft.ts but
// keyed per-composer instead of a single slot.
const DRAFTS_KEY = "golfme:chatDrafts";
// In-memory tokens scope late async completions to the exact persisted
// draft. Clearing on sign-out invalidates every outstanding token.
let generation = 0;
const revisions = new Map<string, number>();
const listeners = new Set<(key: string | null) => void>();
export function chatDraftVersion(key: string): string { return `${generation}:${revisions.get(key) ?? 0}`; }
export function observeChatDrafts(listener: (key: string | null) => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DRAFTS_KEY || event.key === null) listener(null);
  };
  if (typeof window !== "undefined") window.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener?.("storage", onStorage);
  };
}
function notifyDrafts(key: string | null): void { for (const listener of listeners) listener(key); }


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
  // Even a failed persistence attempt is a newer edit. Invalidate older
  // submissions before writing, but only notify readers after success so
  // a quota error cannot replace the new in-memory text with stale storage.
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
  writeAll(drafts);
  notifyDrafts(key);
}

// Drafts aren't stored per account, so signing out (or switching between
// the demo and a real account) clears them: on a shared phone the next
// account must not find someone else's half-typed message.
export function clearChatDrafts(): void {
  generation += 1;
  revisions.clear();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Storage blocked: there were no saved drafts either.
  }
  notifyDrafts(null);
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
