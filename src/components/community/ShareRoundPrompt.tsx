import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { GolfCall } from "../../types";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { resizeImageToDataUrl } from "../../lib/image";
import { formatDate } from "../../lib/format";

interface ShareRoundPromptProps {
  call: GolfCall;
  onClose: () => void;
}

// Shown after a post-round review is submitted — never publishes anything
// on its own, the golfer always has to explicitly tap Share.
export function ShareRoundPrompt({ call, onClose }: ShareRoundPromptProps) {
  const { createPost } = useData();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("Great round today.");
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [imageLoading, setImageLoading] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setImageLoading(true);
    try {
      setImageUrl(await resizeImageToDataUrl(file));
    } finally {
      setImageLoading(false);
    }
  }

  function share() {
    createPost({
      type: "round",
      text: text.trim() || "Great round today.",
      imageUrl,
      golfCallId: call.id,
      category: "Round Stories",
    });
    showToast("Shared with the Community.", "success");
    onClose();
  }

  return (
    <Modal title="Share your round?" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-500">Let other golfers know how it went — totally optional.</p>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <p className="text-sm font-semibold text-slate-800">Played: {call.course}</p>
          <p className="text-xs text-slate-500">{formatDate(call.dateISO)}</p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Great round today."
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fairway-400"
        />
        {imageUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-slate-100">
            <img src={imageUrl} alt="" className="max-h-48 w-full object-cover" />
            <button
              onClick={() => setImageUrl(undefined)}
              aria-label="Remove photo"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/60 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={imageLoading}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-xs font-semibold text-slate-600 hover:border-fairway-300"
          >
            {imageLoading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />} Add a photo (optional)
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <div className="flex gap-3">
          <Button variant="outline" fullWidth onClick={onClose}>
            Not Now
          </Button>
          <Button fullWidth onClick={share}>
            Share
          </Button>
        </div>
      </div>
    </Modal>
  );
}
