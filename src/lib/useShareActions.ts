import { useCallback } from "react";
import { useLocale } from "../i18n/LocaleContext";
import { useToast } from "../context/ToastContext";
import { track } from "./analytics";
import { shareOrCopy } from "./share";
import { buildAppShare, buildRoundShare, isShareableRoundId, shareOrigin } from "./shareLinks";
import { roundCalendarDay } from "./golfCall";
import type { GolfCall } from "../types";

// Share a round / the app with the native sheet, or copy the link with a
// toast. Only the round's id, course name, date and time are handed to the
// builder -- never the host, participants or anything else on the round.
export function useShareActions() {
  const { t, locale } = useLocale();
  const { showToast } = useToast();

  const report = useCallback(
    (outcome: Awaited<ReturnType<typeof shareOrCopy>>, event: "round_shared" | "app_shared") => {
      if (outcome === "shared" || outcome === "copied") track(event);
      if (outcome === "copied") showToast(t("share.copiedToast"), "success");
      if (outcome === "failed") showToast(t("share.failedToast"), "warning");
    },
    [showToast, t],
  );

  const shareRound = useCallback(
    async (call: Pick<GolfCall, "id" | "course" | "dateISO" | "timeLabel">) => {
      if (!isShareableRoundId(call.id)) {
        showToast(t("share.failedToast"), "warning");
        return;
      }
      const dateLabel = roundCalendarDay(call.dateISO).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
      const payload = buildRoundShare(
        { id: call.id, course: call.course, dateLabel, timeLabel: call.timeLabel },
        { title: t("share.roundTitle"), text: t("share.roundText") },
        shareOrigin(typeof window !== "undefined" ? window.location.origin : null),
      );
      report(await shareOrCopy(payload), "round_shared");
    },
    [locale, t, report, showToast],
  );

  const shareApp = useCallback(async () => {
    const payload = buildAppShare(
      { title: t("share.appTitle"), text: t("share.appText") },
      shareOrigin(typeof window !== "undefined" ? window.location.origin : null),
    );
    report(await shareOrCopy(payload), "app_shared");
  }, [t, report]);

  return { shareRound, shareApp };
}
