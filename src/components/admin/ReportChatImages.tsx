import { useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { chatImageUrls } from "../../lib/chatImageClient";
import { chatVideoUrls } from "../../lib/chatVideoClient";
import { mediaFromRow } from "../../lib/chatMedia";

interface ReportMediaItem {
  key: string;
  kind: "image" | "video";
  expired: boolean;
  url: string | null;
  sentAt: string;
}

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

interface ReportVoice {
  message_id: string;
  chat: string;
  audio_path: string;
  duration_ms: number;
  sent_at: string;
}

export function ReportChatImages({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [photos, setPhotos] = useState<(ReportPhoto & { url: string | null })[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [clips, setClips] = useState<(ReportVoice & { url: string | null })[]>([]);
  const [media, setMedia] = useState<ReportMediaItem[]>([]);

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
    // Voice messages (migration 20261107180000); absent before it: none.
    const voice = await supabase.rpc("admin_list_report_chat_voice", { p_report_id: reportId });
    const voiceRows = (voice.error ? [] : (voice.data ?? [])) as ReportVoice[];
    const voiceUrls = await Promise.all(voiceRows.map((r) => chatImageUrls().get(r.audio_path)));
    setClips(voiceRows.map((r, i) => ({ ...r, url: voiceUrls[i] })));
    // Videos / albums (migration 20261107220000); absent before it: none.
    const mediaRes = await supabase.rpc("admin_list_report_chat_media", { p_report_id: reportId });
    const mediaRows = (mediaRes.error ? [] : (mediaRes.data ?? [])) as { message_id: string; media: unknown; sent_at: string }[];
    const items: ReportMediaItem[] = [];
    for (const row of mediaRows) {
      for (const [i, it] of (mediaFromRow(row.media) ?? []).entries()) {
        const url = it.path ? await chatVideoUrls().get(it.path) : null;
        items.push({ key: `${row.message_id}-${i}`, kind: it.kind, expired: Boolean(it.expired), url, sentAt: row.sent_at });
      }
    }
    setMedia(items);
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
  if (photos.length === 0 && clips.length === 0 && media.length === 0)
    return <p className="text-xs text-slate-500">No photos, videos or voice messages from the reported golfer in this chat (unsent ones aren't kept).</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m) =>
        m.url ? (
          m.kind === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video key={m.key} controls src={m.url} preload="none" playsInline className="h-24 w-32 rounded-lg border border-slate-200 bg-black object-cover" aria-label={`Video sent ${new Date(m.sentAt).toLocaleString()}`} />
          ) : (
            <a key={m.key} href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200">
              <img src={m.url} alt={`Album photo sent ${new Date(m.sentAt).toLocaleString()}`} className="h-24 w-24 object-cover" />
            </a>
          )
        ) : (
          <span key={m.key} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[10px] text-slate-400">
            {m.expired ? "video expired" : "unavailable"}
          </span>
        ),
      )}
      {clips.map((c) =>
        c.url ? (
          <audio key={c.message_id} controls src={c.url} preload="none" className="h-9 max-w-full" aria-label={`Voice message sent ${new Date(c.sent_at).toLocaleString()}`} />
        ) : (
          <span key={c.message_id} className="text-[10px] text-slate-400">voice unavailable</span>
        ),
      )}
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
