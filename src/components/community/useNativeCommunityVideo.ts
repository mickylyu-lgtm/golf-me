import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { openVideoNatively, type NativeVideoSession } from "../../lib/nativeVideoPlayer";

// No source/signing changes: Community continues to use its existing URL.
export function useNativeCommunityVideo(videoRef: RefObject<HTMLVideoElement | null>, src: string | undefined) {
  const sessionRef = useRef<NativeVideoSession | null>(null);
  useEffect(() => () => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
  }, [src]);

  return {
    open: (onFallback: () => void, onEnd?: () => void) => {
      const video = videoRef.current;
      if (!video) {
        onFallback();
        return;
      }
      sessionRef.current = openVideoNatively(video, {
        startAt: video.currentTime, // keep the feed's place, like the prior direct handoff
        onRefused: () => {
          sessionRef.current = null;
          onFallback();
        },
        onEnd: () => {
          sessionRef.current = null;
          onEnd?.();
        },
      });
    },
  };
}
