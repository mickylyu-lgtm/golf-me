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
  visitItems,
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
//
// `scope` is the conversation (DM thread id / round id), with the same visit
// model as the single-photo attachment (lib/chatImageAttachment.ts,
// useChatImageAttachment): each change of it starts a new visit, bumped
// during render; `pick` / `take` are bound to the visit they were rendered
// in, and only the current visit's items are shown. So a picker (web input
// or the native one) that answers after A -> B (or A -> B -> A) calls the
// old visit's `pick` and its files are dropped; a result for an item of an
// earlier visit is dropped and its object URLs revoked; nothing reaches
// another chat's composer or send.
export function useChatMediaAttachment(opts: { limit: number; allowVideos: boolean; onError: (reason: MediaPickError) => void; scope?: string | null }) {
  const [rawState, dispatch] = useReducer(mediaAttachmentReducer, [] as readonly MediaAttachmentItem[]);
  const stateRef = useRef(rawState);
  stateRef.current = rawState;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const seqRef = useRef(0);
  const liveRef = useRef(true);

  const visitRef = useRef({ scope: opts.scope, generation: 0 });
  if (!Object.is(visitRef.current.scope, opts.scope)) visitRef.current = { scope: opts.scope, generation: visitRef.current.generation + 1 };
  const generation = visitRef.current.generation;
  const state = visitItems(rawState, generation);

  // Items of an earlier visit: their object URLs go, then the items.
  const dropOtherVisits = useCallback((g: number) => {
    const stale = stateRef.current.filter((it) => it.generation !== g);
    if (stale.length === 0) return;
    for (const it of stale) release(it);
    dispatch({ type: "leave", generation: g });
    stateRef.current = stateRef.current.filter((it) => it.generation === g);
  }, []);
  useEffect(() => dropOtherVisits(generation), [dropOtherVisits, generation]);

  const pick = useCallback(
    (files: readonly File[]) => {
      // This visit is over (the picker answered after a chat switch): drop.
      if (!liveRef.current || generation !== visitRef.current.generation) return;
      dropOtherVisits(generation);
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
      dispatch({ type: "add", items: accepted.map(({ key, kind }) => ({ key, kind })), limit: Math.min(MEDIA_MAX_ITEMS, limit), generation });
      for (const a of accepted) {
        // Same pick, same visit, still mounted, still waiting.
        const stillWanted = () =>
          liveRef.current &&
          generation === visitRef.current.generation &&
          stateRef.current.some((it) => it.key === a.key && it.state === "processing" && it.generation === generation);
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
    },
    [generation, dropOtherVisits],
  );

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

  // Hands this visit's ready items to a send; their object URLs now belong
  // to the sending bubble (not revoked here). Another visit's: nothing.
  const take = useCallback((): ChatMediaDraftItem[] => {
    if (generation !== visitRef.current.generation) return [];
    const items = readyDraftItems(visitItems(stateRef.current, generation));
    dispatch({ type: "clear" });
    stateRef.current = [];
    return items;
  }, [generation]);

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
