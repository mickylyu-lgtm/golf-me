import { useCallback, useEffect, useReducer, useRef } from "react";
import { ChatImageError, processChatImage } from "./chatImageClient";
import { ChatVideoError, readChatVideo, releaseChatVideo } from "./chatVideoClient";
import {
  MEDIA_MAX_ITEMS,
  mediaAttachmentReducer,
  mediaKindOfFile,
  mediaReady,
  mediaSendKey,
  readyDraftItems,
  sendShape,
  type ChatMediaDraftItem,
  type MediaAttachmentItem,
} from "./chatMedia";

// "unreadable" = a photo that couldn't be decoded (the photo wording, as
// before); "fileUnreadable" = a video or a file of no known kind.
export type MediaPickError = "unreadable" | "fileUnreadable" | "tooLarge" | "videoTooLarge" | "tooMany" | "videoUnavailable";

function release(it: MediaAttachmentItem) {
  if (it.state === "processing") return;
  if (it.kind === "image") URL.revokeObjectURL(it.image.previewUrl);
  else releaseChatVideo(it.video);
}

// The composer's picked photos / videos (lib/chatMedia.ts): pick -> each
// item processed on the device (photos re-encoded, videos read for size /
// length / a poster) -> chips -> taken by one send, or removed. A video
// over 60 s waits in "trimming" until the trim sheet confirms a window.
// Page state only: leaving the thread drops it. `allowVideos` / `limit`
// follow the feature detection: before the media migration, one photo only
// (exactly as before).
export function useChatMediaAttachment(opts: { limit: number; allowVideos: boolean; onError: (reason: MediaPickError) => void }) {
  const [state, dispatch] = useReducer(mediaAttachmentReducer, [] as readonly MediaAttachmentItem[]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const seqRef = useRef(0);
  const liveRef = useRef(true);

  const pick = useCallback((files: readonly File[]) => {
    const { limit, allowVideos, onError } = optsRef.current;
    let list = [...files];
    // One photo at a time before albums exist: a new pick replaces it.
    if (limit <= 1) {
      for (const it of stateRef.current) release(it);
      dispatch({ type: "clear" });
      stateRef.current = [];
      list = list.slice(0, 1);
    }
    const room = Math.max(0, Math.min(MEDIA_MAX_ITEMS, limit) - stateRef.current.length);
    if (list.length > room) {
      onError("tooMany");
      list = list.slice(0, room);
    }
    const accepted: { key: string; kind: "image" | "video"; file: File }[] = [];
    for (const file of list) {
      const kind = mediaKindOfFile(file);
      if (!kind) {
        onError("fileUnreadable");
        continue;
      }
      if (kind === "video" && !allowVideos) {
        onError("videoUnavailable");
        continue;
      }
      accepted.push({ key: `media-${++seqRef.current}-${Date.now()}`, kind, file });
    }
    if (accepted.length === 0) return;
    dispatch({ type: "add", items: accepted.map(({ key, kind }) => ({ key, kind })), limit: Math.min(MEDIA_MAX_ITEMS, limit) });
    for (const a of accepted) {
      const stillWanted = () => liveRef.current && stateRef.current.some((it) => it.key === a.key && it.state === "processing");
      if (a.kind === "image") {
        processChatImage(a.file).then(
          (image) => {
            if (!stillWanted()) return URL.revokeObjectURL(image.previewUrl);
            dispatch({ type: "imageReady", key: a.key, image });
          },
          (err) => {
            if (!stillWanted()) return;
            dispatch({ type: "failed", key: a.key });
            optsRef.current.onError(err instanceof ChatImageError ? err.reason : "unreadable");
          },
        );
      } else {
        readChatVideo(a.file).then(
          (video) => {
            if (!stillWanted()) return releaseChatVideo(video);
            dispatch({ type: "videoRead", key: a.key, video });
          },
          (err) => {
            if (!stillWanted()) return;
            dispatch({ type: "failed", key: a.key });
            optsRef.current.onError(err instanceof ChatVideoError && err.reason === "tooLarge" ? "videoTooLarge" : "fileUnreadable");
          },
        );
      }
    }
  }, []);

  const remove = useCallback((key: string) => {
    const it = stateRef.current.find((x) => x.key === key);
    if (it) release(it);
    dispatch({ type: "remove", key });
  }, []);

  const clear = useCallback(() => {
    for (const it of stateRef.current) release(it);
    dispatch({ type: "clear" });
  }, []);

  const confirmTrim = useCallback((key: string, startMs: number, endMs: number) => {
    dispatch({ type: "trimmed", key, trim: { startMs: Math.round(startMs), endMs: Math.round(endMs) } });
  }, []);

  // Hands the ready items to a send; their object URLs now belong to the
  // sending bubble (not revoked here).
  const take = useCallback((): ChatMediaDraftItem[] => {
    const items = readyDraftItems(stateRef.current);
    dispatch({ type: "clear" });
    stateRef.current = [];
    return items;
  }, []);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      for (const it of stateRef.current) release(it);
    };
  }, []);

  const trimming = state.find((it): it is Extract<MediaAttachmentItem, { state: "trimming" }> => it.state === "trimming") ?? null;
  return {
    state,
    pick,
    remove,
    clear,
    take,
    confirmTrim,
    trimming,
    shape: sendShape(state),
    ready: mediaReady(state),
    busy: state.length > 0 && !mediaReady(state),
    sendKey: mediaSendKey(state),
  };
}
