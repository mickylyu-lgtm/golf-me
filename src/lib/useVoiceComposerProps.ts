import { useRef } from "react";
import { useLocale } from "../i18n/LocaleContext";
import { useToast } from "../context/ToastContext";
import type { VoiceNotice } from "../components/chat/HoldToTalk";
import type { SentVoiceClip, VoiceOrigin } from "./voiceSession";

// ChatComposer's `voice` prop for a thread (DM / round chat): the labels,
// the notices as toasts, the conversation on screen (`origin`) and the
// page's send. `onClip` may change every render (it reads the current reply
// target); the composer gets one stable callback that always calls the
// latest. The clip it receives carries the origin it was RECORDED in
// (lib/voiceSession.ts): the page must send to clip.origin, never to the
// thread it shows now. undefined = no voice here (the backend doesn't have
// it yet, the chat is read-only / blocked, no conversation id).
export function useVoiceComposerProps(enabled: boolean, origin: VoiceOrigin | null, onClip: (clip: SentVoiceClip) => void) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const stableRef = useRef((clip: SentVoiceClip) => onClipRef.current(clip));
  if (!enabled || !origin || !origin.id) return undefined;
  return {
    origin,
    onClip: stableRef.current,
    onNotice: (n: VoiceNotice) => {
      if (n === "tooShort") showToast(t("chat.voiceTooShort"), "info");
      else if (n === "denied") showToast(t("chat.micDenied"), "warning");
      else if (n === "unavailable") showToast(t("chat.micUnavailable"), "warning");
      else showToast(t("chat.voiceNotSent"), "info");
    },
    labels: {
      hold: t("chat.holdToTalk"),
      release: t("chat.releaseToSend"),
      slideToCancel: t("chat.slideUpToCancel"),
      releaseToCancel: t("chat.releaseToCancel"),
      secondsLeft: (n: number) => t("chat.voiceSecondsLeft", { n: String(n) }),
      toVoice: t("chat.switchToVoice"),
      toKeyboard: t("chat.switchToKeyboard"),
    },
  };
}
