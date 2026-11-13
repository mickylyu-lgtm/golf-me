import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { MediaAttachmentStrip } from "../src/components/chat/MediaAttachmentStrip";
import { useChatMediaText } from "../src/lib/useChatMediaText";
import type { MediaAttachmentItem } from "../src/lib/chatMedia";
import "../src/index.css";

const photo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#24664a"/><text x="30" y="150" font-size="25" fill="white">Unsent preview fixture</text></svg>');
const initial = [
  { key: "photo", kind: "image", state: "ready", image: { previewUrl: photo } },
  { key: "video", kind: "video", state: "ready", video: { localUrl: "/artifacts.local/community-video.mp4", posterUrl: null, sourceDurationMs: 6000, trim: { startMs: 1000, endMs: 4000 } } },
] as MediaAttachmentItem[];
function Fixture() {
  const [items, setItems] = useState(initial);
  const [text, setText] = useState("Keep my draft");
  const labels = useChatMediaText();
  return <main className="mx-auto max-w-lg pt-20">
    <textarea aria-label="Draft" value={text} onChange={e => setText(e.target.value)} />
    <output data-testid="attachment-count">{items.length}</output>
    <button onClick={() => setItems(initial)}>Reset fixture</button>
    <MediaAttachmentStrip items={items} onRemove={key => setItems(items => items.filter(item => item.key !== key))} labels={labels.strip} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><Fixture /></LocaleProvider></StrictMode>);
