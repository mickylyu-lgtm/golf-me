import { useEffect, useRef, useState } from "react";
import { localWindowUrl, type ChatMediaItem } from "../../lib/chatMedia";
import { chatVideoUrls } from "../../lib/chatVideoClient";
import { linkLongEnough, openChatVideoNatively, renewDelayMs, type NativeVideoSession } from "../../lib/chatNativeVideo";
import { useChatImageUrl } from "../../lib/useChatImageUrl";
import type { OutgoingMediaItemState } from "../../types";

// One chat video's source + its native player (lib/chatNativeVideo.ts).
//
// - The link is this viewer's own signed URL (chat-video cache). It is
//   re-signed ahead of expiry while the bubble is on the page, so a tap
//   almost always finds a link with plenty of life; one too close to expiry
//   is renewed and the tap opens the in-app viewer instead (it signs a fresh
//   link), because the native player can only be opened inside the tap.
// - While the native player is open the element's src is pinned: a
//   re-signed link arriving meanwhile never swaps the video under the player.
// - A load error while open closes the player, then the usual re-sign /
//   give-up path runs (useChatImageUrl).
// `item` null: no video here (an album card that isn't a video / not on top).
export function useNativeChatVideo(item: ChatMediaItem | null, local?: OutgoingMediaItemState | null) {
  const urls = chatVideoUrls();
  const path = item && !item.expired ? (item.path ?? null) : null;
  const localUrl = item && local ? localWindowUrl(local.localUrl, local.trim) : null;
  const src = useChatImageUrl(path, localUrl, urls);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<NativeVideoSession | null>(null);
  const lastRenewRef = useRef(0);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    if (!path || localUrl || pinned || !src.url) return;
    const delay = renewDelayMs(urls.expiresAt(path), Date.now(), lastRenewRef.current);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      if (sessionRef.current) return;
      lastRenewRef.current = Date.now();
      urls.renew(path);
      void urls.get(path); // a fresh link reaches src through the cache's subscription
    }, delay);
    return () => window.clearTimeout(timer);
  }, [path, localUrl, pinned, src.url, urls]);

  useEffect(() => () => sessionRef.current?.cancel(), []);

  function endSession() {
    sessionRef.current = null;
    setPinned(null);
  }

  /**
   * Call synchronously from the tap. `onFallback` opens the in-app viewer;
   * `onEnd` runs when the native player closes (the element is muted again).
   */
  function open(onFallback: () => void, onEnd?: () => void) {
    const el = videoRef.current;
    if (!item || !el || !src.url || src.unavailable) {
      onFallback();
      return;
    }
    const now = Date.now();
    const fresh = !!localUrl || !path || (urls.peek(path) === src.url && linkLongEnough(urls.expiresAt(path), now));
    if (!fresh) {
      if (path && now - lastRenewRef.current >= 1000) {
        lastRenewRef.current = now;
        urls.renew(path);
        void urls.get(path);
      }
      onFallback();
      return;
    }
    const trim = localUrl ? local?.trim : null;
    setPinned(src.url);
    sessionRef.current = openChatVideoNatively(el, {
      startAt: trim ? trim.startMs / 1000 : 0,
      endAt: trim ? trim.endMs / 1000 : undefined,
      onRefused: () => {
        endSession();
        onFallback();
      },
      onEnd: () => {
        endSession();
        onEnd?.();
      },
    });
  }

  function onError() {
    if (sessionRef.current) {
      sessionRef.current.cancel();
      endSession();
    }
    src.onError();
  }

  return {
    url: pinned ?? src.url,
    unavailable: src.unavailable,
    onLoad: src.onLoad,
    onError,
    videoRef,
    open,
    isOpen: () => sessionRef.current !== null,
  };
}
