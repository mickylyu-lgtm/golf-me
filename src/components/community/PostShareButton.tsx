import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { useToast } from "../../context/ToastContext";
import { buildPostShare } from "../../lib/postShare";
import { shareOrCopy } from "../../lib/share";
import { usePreparedShare } from "../../lib/usePreparedShare";

export function PostShareButton({ postId }: { postId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const { url, prepare, isDemo, failed } = usePreparedShare("post", postId);
  const busy = useRef(false);
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (busy.current) return;
    const payload = buildPostShare(postId, { title: t("share.postTitle"), text: t("share.postText") });
    if (!payload) { showToast(t("share.failedToast"), "warning"); return; }
    if (!url && !isDemo) { prepare(); showToast(t(failed ? "share.failedToast" : "share.preparingToast"), failed ? "warning" : "info"); return; }
    busy.current = true;
    setSharing(true);
    try {
      const outcome = await shareOrCopy({ ...payload, url: url || payload.url });
      if (outcome === "copied") showToast(t("share.copiedToast"), "success");
      if (outcome === "failed") showToast(t("share.failedToast"), "warning");
    } catch { showToast(t("share.failedToast"), "warning"); }
    finally { busy.current = false; setSharing(false); }
  }
  return <button type="button" disabled={sharing} aria-label={t("share.sharePost")} onClick={(e) => { e.stopPropagation(); void share(); }}
    className="relative flex items-center justify-center rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 after:absolute after:inset-x-0 after:-inset-y-2 transition-all duration-200 ease-out hover:border-sun-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fairway-500 disabled:opacity-60">
    <Share2 size={13} aria-hidden="true" />
  </button>;
}
