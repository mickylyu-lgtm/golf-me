import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AttachmentState, ProcessedChatImage } from "./chatImages";
import { ChatImageError, processChatImage } from "./chatImageClient";
import { createChatImageAttachment } from "./chatImageAttachment";

// The composer's one photo (lib/chatImageAttachment.ts): pick -> processing
// -> ready (preview chip) -> taken by a send, or removed. Page state only:
// leaving the thread drops it (its preview URL is revoked), it is never
// saved as a draft. `onError` gets "unreadable" / "tooLarge".
//
// `scope` is the conversation (DM thread id / round id). Each change of it
// starts a new visit, and `pick` is bound to the visit it was rendered in:
// the composer hands that `pick` to the async photo picker at tap time, so
// a picker that answers after the user moved to another chat (or came back
// to this one) calls the old visit's `pick`, which drops the file.
export function useChatImageAttachment(onError: (reason: "unreadable" | "tooLarge") => void, scope?: string | null) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // Bumped during render the moment the scope changes, so the very render
  // that shows the new chat already has a new `pick` and hides the old
  // photo (an abandoned render can only make a pending pick stale).
  const visitRef = useRef({ scope, generation: 0 });
  if (!Object.is(visitRef.current.scope, scope)) visitRef.current = { scope, generation: visitRef.current.generation + 1 };
  const generation = visitRef.current.generation;

  const [attachment] = useState(() =>
    createChatImageAttachment({
      process: processChatImage,
      revoke: (url) => URL.revokeObjectURL(url),
      generation: () => visitRef.current.generation,
      failureReason: (err) => (err instanceof ChatImageError ? err.reason : "unreadable"),
      onError: (reason) => onErrorRef.current(reason),
    }),
  );
  useSyncExternalStore(attachment.subscribe, attachment.snapshot, attachment.snapshot);
  const state: AttachmentState = attachment.view(generation);

  // A new visit: the previous chat's photo (ready or still processing) goes.
  useEffect(() => attachment.leave(generation), [attachment, generation]);
  // Unmount: drop an unsent photo; anything still processing is stale.
  useEffect(() => {
    attachment.mount();
    return () => attachment.dispose();
  }, [attachment]);

  const pick = useCallback((file: File) => void attachment.pick(generation, file), [attachment, generation]);
  const remove = useCallback(() => attachment.remove(), [attachment]);
  // Hands this chat's ready photo to a send; its preview URL now belongs to
  // the sending bubble (not revoked here).
  const take = useCallback((): ProcessedChatImage | null => attachment.take(generation), [attachment, generation]);

  return { state, pick, remove, take };
}
