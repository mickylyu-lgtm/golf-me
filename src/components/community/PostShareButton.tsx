import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { useLocale } from "../../i18n/LocaleContext";
import { useToast } from "../../context/ToastContext";
import { buildPostShare } from "../../lib/postShare";
import { shareOrCopy } from "../../lib/share";

export function PostShareButton({ postId }: { postId: string }) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const busy = useRef(false);
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (busy.current) return;
    const payload = buildPostShare(postId, { title: t("share.postTitle"), text: t("share.postText") });
    if (!payload) { showToast(t("share.failedToast"), "warning"); return; }
    busy.current = true;
    setSharing(true);
    try {
      const outcome = await shareOrCopy(payload);
      if (outcome === "copied") showToast(t("share.copiedToast"), "success");
      if (outcome === "failed") showToast(t("share.failedToast"), "warning");
    } finally { busy.current = false; setSharing(false); }
  }
  return <button type="button" disabled={sharing} aria-label={t("share.sharePost")} onClick={(e) => { e.stopPropagation(); void share(); }}
    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-fairway-200 bg-fairway-50 px-4 text-sm font-semibold text-fairway-800 transition-colors hover:bg-fairway-100 disabled:opacity-60">
    <Share2 size={17} aria-hidden="true" />{t("share.sharePost")}
  </button>;
}
