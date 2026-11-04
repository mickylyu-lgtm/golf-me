// What happens to a DM whose send fails. The composer is cleared the moment
// Send is tapped, so by the time a slow failure comes back the golfer may
// already be typing the next message, or have swiped to reply to a
// different one. Putting the failed text back then would overwrite that
// newer input (Micky, 2026-11-04: message A failing after B was typed
// replaced B, and A's reply target replaced the new one).
//
// Rule: the failed text goes back into the composer only when the composer
// is still exactly as the send left it (same thread, empty, no reply
// selected). Otherwise it is kept as a "Not sent" bubble the golfer can
// retry or discard, so neither message is lost. If the thread was left
// meanwhile, it becomes that thread's saved draft, but only if that draft
// is empty.
// No React imports, so tests/dmComposer.test.ts runs under plain node.
import type { SendMessageResult } from "./objectionableContent.ts";

export interface FailedDm {
  key: string;
  // The other golfer's id (the DM route param): the thread it belongs to.
  threadId: string;
  text: string;
  replyToId: string | null;
  // Rejected by the content filter: retrying the same text can't help.
  objectionable: boolean;
}

// The composer as it is now, read when the send settles (not the values
// the send closed over). null when the thread page has unmounted.
export interface ComposerSnapshot {
  threadId: string | undefined;
  text: string;
  replyToId: string | null;
}

export type FailedSendOutcome = "restore" | "draft" | "keep";

export function failedSendOutcome(now: ComposerSnapshot | null, failedThreadId: string, savedDraft: string): FailedSendOutcome {
  if (now && now.threadId === failedThreadId) {
    return now.text.trim() === "" && now.replyToId === null ? "restore" : "keep";
  }
  // Left the thread (switched to another one, or the page unmounted): the
  // composer on screen isn't this thread's, so only its saved draft can
  // hold the text, and only when nothing newer was saved there.
  // Otherwise keep it as a bubble: shown if the golfer switches back to
  // this thread on the same page. (If the page is gone too, the newer
  // saved draft wins and only the "didn't send" toast remains.)
  return savedDraft.trim() === "" ? "draft" : "keep";
}

export interface DmSendIo {
  threadId: string;
  text: string;
  replyToId: string | null;
  // Clear the composer and reply target (before the network call).
  clear: () => void;
  send: (text: string, replyToId: string | null) => Promise<SendMessageResult>;
  snapshot: () => ComposerSnapshot | null;
  loadDraft: (threadId: string) => string;
  restore: (text: string, replyToId: string | null) => void;
  saveDraft: (threadId: string, text: string) => void;
  keepFailed: (failed: FailedDm) => void;
  newKey: () => string;
}

export type DmSendResult = { result: SendMessageResult; outcome: FailedSendOutcome | null };

// The DM thread's whole send path, framework-free so the delayed-failure
// race can be tested against the real logic.
export async function sendDmWithRecovery(io: DmSendIo): Promise<DmSendResult> {
  io.clear();
  const result = await io.send(io.text, io.replyToId);
  if (result === "sent") return { result, outcome: null };
  return { result, outcome: recoverFailedDm(io, result) };
}

export function recoverFailedDm(io: DmSendIo, result: Exclude<SendMessageResult, "sent">): FailedSendOutcome {
  const outcome = failedSendOutcome(io.snapshot(), io.threadId, io.loadDraft(io.threadId));
  if (outcome === "restore") io.restore(io.text, io.replyToId);
  else if (outcome === "draft") io.saveDraft(io.threadId, io.text);
  else
    io.keepFailed({ key: io.newKey(), threadId: io.threadId, text: io.text, replyToId: io.replyToId, objectionable: result === "objectionable" });
  return outcome;
}
