// One visible feed preview at a time. Native/fullscreen playback owns its
// element; it must never be paused by feed visibility or tab changes.
export function createFeedVideoAutoplay() {
  const videos = new Map<HTMLVideoElement, number>();
  const blocked = new Set<object>();
  let selected: HTMLVideoElement | null = null;
  let observer: IntersectionObserver | null = null;
  let mutations: MutationObserver | null = null;
  const native = (el: HTMLVideoElement) => el.hasAttribute("data-native-video-player");
  function update() {
    const hasNative = !!document.querySelector("[data-native-video-player]");
    let next: HTMLVideoElement | null = null;
    let best = 0.6;
    if (!document.hidden && !blocked.size && !hasNative) {
      for (const [el, ratio] of videos) {
        if (ratio >= best && el.isConnected) { best = ratio; next = el; }
      }
    }
    if (next === selected) return;
    selected = next;
    for (const el of videos.keys()) if (el !== next && !native(el)) el.pause();
    if (next) {
      const el = next;
      void el.play().then(() => {
        // A slow play promise must not restart a video after navigation.
        if ((selected !== el) && !native(el)) el.pause();
      }).catch(() => { /* Low Power Mode etc: keep the tap-to-play fallback. */ });
    }
  }
  function start() {
    if (observer || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (videos.has(entry.target as HTMLVideoElement)) {
        videos.set(entry.target as HTMLVideoElement, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      update();
    }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 0.9, 1] });
    document.addEventListener("visibilitychange", update);
    // The existing native player already marks its synchronous ownership.
    mutations = new MutationObserver(update);
    mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-native-video-player"] });
  }
  return {
    register(el: HTMLVideoElement) {
      start();
      videos.set(el, 0);
      observer?.observe(el);
      return () => {
        observer?.unobserve(el);
        videos.delete(el);
        if (!native(el)) el.pause();
        update();
        if (!videos.size) {
          observer?.disconnect(); observer = null;
          mutations?.disconnect(); mutations = null;
          document.removeEventListener("visibilitychange", update);
        }
      };
    },
    block(owner: object, value: boolean) {
      if (value) blocked.add(owner); else blocked.delete(owner);
      update();
    },
    refresh: update,
  };
}
export const feedVideoAutoplay = createFeedVideoAutoplay();
