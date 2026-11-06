import { useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { chatImageUrls } from "../../lib/chatImageClient";

// Admin dashboard, inside a 'chat' / 'round' report: the photos the reported
// golfer sent in that chat (public.admin_list_report_chat_images, admin
// only; migration 20261107170000). Loaded on demand, signed for this admin
// by the bucket's admin read rule (short-lived, in memory only). A photo the
// sender unsent is gone: the hidden copy keeps text only.
interface ReportPhoto {
  message_id: string;
  chat: string;
  image_path: string;
  image_width: number;
  image_height: number;
  sent_at: string;
}

export function ReportChatImages({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [photos, setPhotos] = useState<(ReportPhoto & { url: string | null })[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setState("loading");
    const { data, error } = await supabase.rpc("admin_list_report_chat_images", { p_report_id: reportId });
    if (error) {
      setMessage(error.code === "PGRST202" ? "Chat photos aren't enabled in this database yet." : error.message);
      setState("error");
      return;
    }
    const rows = (data ?? []) as ReportPhoto[];
    const urls = await Promise.all(rows.map((r) => chatImageUrls().get(r.image_path)));
    setPhotos(rows.map((r, i) => ({ ...r, url: urls[i] })));
    setState("done");
  }

  if (state === "idle") {
    return (
      <button type="button" onClick={load} className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs font-semibold text-fairway-700 hover:bg-fairway-50">
        <ImageIcon size={13} aria-hidden="true" /> Show photos from this chat
      </button>
    );
  }
  if (state === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Loading photos…
      </p>
    );
  }
  if (state === "error") return <p className="text-xs text-rose-600">{message}</p>;
  if (photos.length === 0) return <p className="text-xs text-slate-500">No photos from the reported golfer in this chat (unsent photos aren't kept).</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) =>
        p.url ? (
          <a key={p.message_id} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200">
            <img src={p.url} alt={`Photo sent ${new Date(p.sent_at).toLocaleString()}`} className="h-24 w-24 object-cover" />
          </a>
        ) : (
          <span key={p.message_id} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[10px] text-slate-400">
            unavailable
          </span>
        ),
      )}
    </div>
  );
}
