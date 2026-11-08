import { useMemo } from "react";
import { useLocale } from "../i18n/LocaleContext";
import { MEDIA_MAX_ITEMS, VIDEO_MAX_MS, localWindowUrl, mediaLabel, type ChatMediaItem } from "./chatMedia";
import { chatVideoUrls } from "./chatVideoClient";
import type { ChatMediaLabels } from "../components/chat/ChatMedia";
import type { MediaPickError } from "./useChatMediaAttachment";
import type { OutgoingMediaItemState, PostMediaItem } from "../types";

// Every localized string the chat media UI needs, in one place for
// DirectMessageThread and GroupChat.
export function useChatMediaText() {
  const { t } = useLocale();
  return useMemo(() => {
    const labels: ChatMediaLabels = {
      video: t("chat.videoAlt"),
      photo: t("chat.photoAlt"),
      openFullscreen: t("chat.videoFullscreen"),
      soundOn: t("chat.videoSoundOn"),
      soundOff: t("chat.videoSoundOff"),
      expired: t("chat.videoExpired"),
      unavailable: t("chat.mediaUnavailable"),
      unsupported: t("chat.voiceUnsupported"),
      processing: t("chat.videoProcessing"),
      album: (n) => t("chat.albumLabel", { n }),
      position: (n, total) => t("chat.albumPosition", { n, total }),
      previous: t("chat.albumPrevious"),
      next: t("chat.albumNext"),
    };
    const label = (media: readonly { kind: "image" | "video" }[]) =>
      mediaLabel(media, {
        video: t("chat.video"),
        photos: (n) => (n === 1 ? t("chat.mediaOnePhoto") : t("chat.mediaPhotos", { n })),
        videos: (n) => (n === 1 ? t("chat.mediaOneVideo") : t("chat.mediaVideos", { n })),
        mixed: (photos, videos) => t("chat.mediaMixed", { photos, videos }),
        list: (inner) => t("chat.mediaList", { inner }),
      });
    const strip = {
      removePhoto: t("chat.removePhoto"),
      removeVideo: t("chat.removeVideo"),
      processing: t("chat.mediaPreparing"),
      photoReady: t("chat.photoReady"),
      videoReady: t("chat.videoReady"),
      needsTrim: t("chat.videoNeedsTrim"),
      count: (n: number) => t("chat.mediaCount", { n, max: MEDIA_MAX_ITEMS }),
    };
    const trim = { title: t("chat.trimTitle"), instructions: t("chat.trimInstructions", { max: VIDEO_MAX_MS / 1000 }), confirm: t("chat.trimConfirm") };
    const pickError = (reason: MediaPickError) =>
      reason === "tooLarge"
        ? t("chat.photoTooLarge")
        : reason === "videoTooLarge"
          ? t("chat.videoTooLarge")
          : reason === "tooMany"
            ? t("chat.mediaTooMany", { max: MEDIA_MAX_ITEMS })
            : reason === "videoUnavailable"
              ? t("chat.videoUnavailableHere")
              : reason === "unreadable"
                ? t("chat.photoUnreadable")
                : t("chat.mediaUnreadable");
    return { labels, label, strip, trim, pickError, addLabel: t("chat.addMedia"), sending: t("chat.mediaSending"), notSent: t("chat.mediaNotSent"), rejected: t("chat.mediaRejected") };
  }, [t]);
}

/**
 * The fullscreen viewer's items for a media message (expired videos left
 * out), and where `index` lands among them. This device's own copies are
 * used when there are some; everything else is signed for this viewer.
 */
export async function chatMediaViewerItems(
  media: readonly ChatMediaItem[],
  index: number,
  locals?: readonly OutgoingMediaItemState[] | null,
): Promise<{ items: PostMediaItem[]; index: number }> {
  const urls = chatVideoUrls();
  const out: PostMediaItem[] = [];
  let start = 0;
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    if (m.expired || !m.path) continue;
    const local = locals?.[i];
    const url = local ? (m.kind === "video" ? localWindowUrl(local.localUrl, local.trim) : local.localUrl) : await urls.get(m.path);
    if (!url) continue;
    const poster = m.kind === "video" ? (local?.posterUrl ?? (m.poster ? await urls.get(m.poster) : null)) : null;
    if (i === index) start = out.length;
    out.push({ id: `chat-media-${i}`, type: m.kind, url, ...(poster ? { thumbnailUrl: poster } : {}), ...(m.kind === "video" ? { nativeControls: true } : {}) });
  }
  return { items: out, index: start };
}
