import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { MediaCarousel } from "../src/components/community/MediaCarousel";
import { FullscreenMediaViewer } from "../src/components/community/FullscreenMediaViewer";
import { useBlockFeedAutoplay } from "../src/components/community/useFeedVideoAutoplay";
import type { PostMediaItem } from "../src/types";
import "../src/index.css";
const media: PostMediaItem[] = [
  { id: "video-a", type: "video", url: "/fixture-video.mp4" },
  { id: "photo", type: "image", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='500'%3E%3Crect width='400' height='500' fill='green'/%3E%3C/svg%3E" },
  { id: "video-b", type: "video", url: "/fixture-video.mp4" },
];
export function Fixture() {
  const [viewer, setViewer] = useState<number | null>(null);
  const [mounted, setMounted] = useState(true);
  useBlockFeedAutoplay(viewer !== null);
  return <LocaleProvider><div className="mx-auto max-w-md p-4">
    <h1>Synthetic community autoplay test</h1>
    <button id="unmount" onClick={() => setMounted(false)}>Unmount feed</button>
    {mounted && <><section id="first"><MediaCarousel media={media} variant="card" onItemClick={setViewer} /></section>
    <div style={{height: 700}}>Scroll down</div>
    <section id="second"><MediaCarousel media={[{...media[0], id: "video-c"}]} variant="card" onItemClick={() => setViewer(0)} /></section>
    <div style={{height: 900}} /></>}
    {viewer !== null && <FullscreenMediaViewer media={media} initialIndex={viewer} onClose={() => setViewer(null)} />}
  </div></LocaleProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
