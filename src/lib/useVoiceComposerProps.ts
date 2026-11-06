import { useRef } from "react";
import { useLocale } from "../i18n/LocaleContext";
import { useToast } from "../context/ToastContext";
import type { VoiceNotice } from "../components/chat/HoldToTalk";
import type { VoiceClip } from "./voiceRecorder";

// ChatComposer's `voice` prop for a thread (DM / round chat): the labels,
// the notices as toasts, and the page's send. `onClip` may change every
// render (it reads the current reply target); the composer gets one stable
// callback that always calls the latest. undefined = no voice here (the
// backend doesn't have it yet, the chat is read-only / blocked).
export function useVoiceComposerProps(enabled: boolean, onClip: (clip: VoiceClip) => void) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const stableRef = useRef((clip: VoiceClip) => onClipRef.current(clip));
  if (!enabled) return undefined;
  return {
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
