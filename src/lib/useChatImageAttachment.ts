import { useCallback, useEffect, useReducer, useRef } from "react";
import { attachmentReducer, type AttachmentState, type ProcessedChatImage } from "./chatImages";
import { ChatImageError, processChatImage } from "./chatImageClient";

// The composer's one photo (lib/chatImages.ts attachmentReducer): pick ->
// processing -> ready (preview chip) -> taken by a send, or removed. Page
// state only: leaving the thread drops it (its preview URL is revoked), it
// is never saved as a draft. `onError` gets "unreadable" / "tooLarge".
export function useChatImageAttachment(onError: (reason: "unreadable" | "tooLarge") => void) {
  const [state, dispatch] = useReducer(attachmentReducer, { kind: "none" } as AttachmentState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const seqRef = useRef(0);

  const pick = useCallback((file: File) => {
    const previous = stateRef.current;
    if (previous.kind === "ready") URL.revokeObjectURL(previous.image.previewUrl);
    const key = `photo-${++seqRef.current}-${Date.now()}`;
    dispatch({ type: "pick", key });
    processChatImage(file).then(
      (image) => {
        // Picked again or removed meanwhile: this result is stale.
        const now = stateRef.current;
        if (now.kind !== "processing" || now.key !== key) {
          URL.revokeObjectURL(image.previewUrl);
          return;
        }
        dispatch({ type: "processed", key, image });
      },
      (err) => {
        const now = stateRef.current;
        if (now.kind !== "processing" || now.key !== key) return;
        dispatch({ type: "failed", key });
        onErrorRef.current(err instanceof ChatImageError ? err.reason : "unreadable");
      },
    );
  }, []);

  const remove = useCallback(() => {
    const now = stateRef.current;
    if (now.kind === "ready") URL.revokeObjectURL(now.image.previewUrl);
    dispatch({ type: "remove" });
  }, []);

  // Hands the ready photo to a send; its preview URL now belongs to the
  // sending bubble (not revoked here).
  const take = useCallback((): ProcessedChatImage | null => {
    const now = stateRef.current;
    if (now.kind !== "ready") return null;
    dispatch({ type: "sent" });
    stateRef.current = { kind: "none" };
    return now.image;
  }, []);

  // Unmount: drop an unsent photo.
  useEffect(
    () => () => {
      const now = stateRef.current;
      if (now.kind === "ready") URL.revokeObjectURL(now.image.previewUrl);
    },
    [],
  );

  return { state, pick, remove, take };
}
