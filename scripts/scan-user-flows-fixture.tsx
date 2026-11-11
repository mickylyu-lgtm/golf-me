import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCommentDraft } from "../src/lib/useCommentDraft";
import { clearChatDrafts } from "../src/lib/chatDraft";
import { EditTeeTimeModal } from "../src/components/golfcall/EditTeeTimeModal";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { ToastProvider } from "../src/context/ToastContext";
import "../src/index.css";

const state = { pending: [] as { resolve: () => void; reject: (e: Error) => void }[], saves: [] as unknown[] };
(window as any).__scan = state;
export function Composer({ owner, post }: { owner: string; post: string }) {
  const draft = useCommentDraft(owner, post);
  const [result, setResult] = useState("");
  return <section>
    <label>Comment<input aria-label="Comment" value={draft.text} onChange={e => draft.update(e.target.value)} /></label>
    <button disabled={draft.submitting || !draft.text.trim()} onClick={async () => {
      const out = await draft.submit(() => new Promise<void>((resolve, reject) => state.pending.push({ resolve, reject })));
      if (out.status !== "stale") setResult(out.status);
    }}>Send comment</button>
    <output data-testid="result">{result}</output>
  </section>;
}
export function Fixture() {
  const [owner, setOwner] = useState("owner-a");
  const [post, setPost] = useState("post-a");
  const [mounted, setMounted] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState(0);
  return <main className="p-4">
    <div className="flex flex-wrap gap-3 mb-4">
      <button onClick={() => setPost(p => p === "post-a" ? "post-b" : "post-a")}>Switch post</button>
      <button onClick={() => { clearChatDrafts(); setOwner(o => o === "owner-a" ? "owner-b" : "owner-a"); }}>Switch account</button>
      <button onClick={() => setMounted(v => !v)}>Toggle composer</button>
      <button onClick={() => { setEditKey(n => n + 1); setEditing(true); }}>Edit round</button>
    </div>
    {mounted && <Composer owner={owner} post={post} />}
    {editing && <EditTeeTimeModal key={editKey} call={{ id:"round-one", course:"Synthetic original course", courseId:"course-one", courseLat:40.7, courseLng:-74, areaLabel:"Synthetic town", dateISO:"2099-11-20T12:00:00Z", timeLabel:"10 AM", teeTimeSource:"manual", bookingStatus:"not_booked" } as any} onClose={() => setEditing(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><ToastProvider><Fixture /></ToastProvider></LocaleProvider></StrictMode>);
