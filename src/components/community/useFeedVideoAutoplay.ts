import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { feedVideoAutoplay } from "../../lib/feedVideoAutoplay";

export function useFeedVideoAutoplay(ref: RefObject<HTMLVideoElement | null>, src: string | undefined, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !src) return;
    return feedVideoAutoplay.register(el);
  }, [ref, src, enabled]);
}

export function useBlockFeedAutoplay(blocked: boolean) {
  const owner = useRef({});
  useEffect(() => {
    const key = owner.current;
    feedVideoAutoplay.block(key, blocked);
    return () => feedVideoAutoplay.block(key, false);
  }, [blocked]);
}
