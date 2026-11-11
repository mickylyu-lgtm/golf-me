import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { ToastProvider } from "../src/context/ToastContext";
import { PostCard } from "../src/components/community/PostCard";
import { Modal } from "../src/components/ui/Modal";
import { FullscreenMediaViewer } from "../src/components/community/FullscreenMediaViewer";
import "../src/index.css";
const video = "/artifacts.local/community-video.mp4";
const photo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#24664a"/><text x="60" y="150" font-size="25" fill="white">Synthetic gallery photo</text></svg>');
const media = [{ id: "one", type: "video", url: video }, { id: "photo", type: "image", url: photo }, { id: "two", type: "video", url: video }];
const base = { authorId: "qa-author", text: "Synthetic local playback test", createdAt: new Date().toISOString(), category: "General" };
export function Fixture() {
  const [show, setShow] = useState(true);
  const [gallery, setGallery] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  return <main className="mx-auto max-w-lg">
    <button onClick={() => setShow(v => !v)}>Toggle posts</button>
    <button onClick={() => setGallery(true)}>Open gallery</button>
    <button onClick={() => setSheet(true)}>Open photo sheet</button>
    {show && <>
      <section data-testid="swing"><PostCard post={{ ...base, id: "qa-swing", type: "swing", videoUrl: video } as any} /></section>
      <section data-testid="album"><PostCard post={{ ...base, id: "qa-album", type: "photo", media } as any} /></section>
    </>}
    {sheet && <Modal title="Photo sheet" onClose={() => setSheet(false)}><button onClick={() => setPhotoOpen(true)}>View photo</button></Modal>}
    {photoOpen && <FullscreenMediaViewer media={[{ id: "photo", type: "image", url: photo }]} onClose={() => setPhotoOpen(false)} />}
    {gallery && <FullscreenMediaViewer media={media as any} onClose={() => setGallery(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter><LocaleProvider><ToastProvider><Fixture /></ToastProvider></LocaleProvider></MemoryRouter></StrictMode>);
