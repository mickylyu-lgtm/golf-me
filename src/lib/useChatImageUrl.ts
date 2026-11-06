import { useCallback, useEffect, useState } from "react";
import { chatImageUrls } from "./chatImageClient";
import type { ChatImageUrlCache } from "./chatImageUrlCache";

// The URL to show for one chat photo, from the shared in-memory cache
// (lib/chatImageUrlCache.ts). `onError` (the <img> failed: an expired or
// refused link, a deleted object) re-signs it a few times, then gives up as
// unavailable; `onLoad` resets that count. A local URL (sending, demo) wins.
// `cache`: chat videos / albums use the chat-video bucket's own cache
// (lib/chatVideoClient.ts chatVideoUrls); photos and voice the default.
export function useChatImageUrl(path: string | null | undefined, localUrl?: string | null, cache?: ChatImageUrlCache) {
  const urls = cache ?? chatImageUrls();
  const [url, setUrl] = useState<string | null>(() => localUrl ?? (path ? urls.peek(path) : null));
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (localUrl) {
      setUrl(localUrl);
      setUnavailable(false);
      return;
    }
    if (!path) {
      setUrl(null);
      return;
    }
    let live = true;
    const load = () => {
      const now = urls.peek(path);
      if (now) {
        setUrl(now);
        setUnavailable(false);
        return;
      }
      void urls.get(path).then((next) => {
        if (!live) return;
        setUrl(next);
        setUnavailable(next === null);
      });
    };
    load();
    const unsubscribe = urls.subscribe((changed) => {
      if (changed === path) load();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [path, localUrl, urls]);

  const onError = useCallback(() => {
    if (!path || localUrl) {
      setUnavailable(true);
      return;
    }
    if (!urls.invalidate(path)) {
      setUnavailable(true);
      return;
    }
    void urls.get(path).then((next) => {
      setUrl(next);
      setUnavailable(next === null);
    });
  }, [path, localUrl, urls]);

  const onLoad = useCallback(() => {
    if (path) urls.loaded(path);
  }, [path, urls]);

  return { url, unavailable, onError, onLoad };
}
